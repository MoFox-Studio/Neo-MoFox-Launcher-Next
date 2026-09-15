import { createWriteStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DownloadProgress, RangeDownloadOptions } from '../../shared/domain/download';
import { MofoxError } from '../../shared/domain/error';
import { describeNetworkError } from './network-error';

// 负责将 HTTP(S) 资源写入本地文件；在服务端支持时按字节范围并发下载。
type ProgressListener = (progress: DownloadProgress) => void;

interface ResolvedOptions {
  concurrency: number;
  minChunkBytes: number;
  maxRedirects: number;
  maxBytes: number;
  allowedHosts: ReadonlySet<string>;
  allowInsecureHttp: boolean;
  signal?: AbortSignal;
}

export interface SecureRangeDownloadOptions extends RangeDownloadOptions {
  signal?: AbortSignal;
  /** 下载体积硬上限；Content-Length 缺失时仍在流式写入阶段执行。 */
  maxBytes?: number;
  /** 除初始主机外允许重定向到的精确主机名。 */
  allowedRedirectHosts?: readonly string[];
  /** 仅供本地测试服务器使用；生产下载默认拒绝明文 HTTP。 */
  allowInsecureHttp?: boolean;
}

/**
 * 将 HTTP(S) 资源下载到本地文件，服务端支持时按字节范围并发下载。
 *
 * 不可信的长度、小文件或不支持 Range 时退化为单流下载；
 * 下载失败或取消时移除不完整文件，避免调用方误将其视为有效产物。
 *
 * @param url - 资源的完整 URL。
 * @param destination - 本地目标文件路径。
 * @param options - 并发数、最小分片、重定向上限与可选的取消信号。
 * @param onProgress - 可选的进度回调。
 * @throws {MofoxError} 下载失败、服务端拒绝 Range 或参数非法时抛出。
 */
export async function downloadRange(
  url: string,
  destination: string,
  options: SecureRangeDownloadOptions = {},
  onProgress?: ProgressListener,
): Promise<void> {
  const resolved = resolveOptions(url, options);
  await mkdir(dirname(destination), { recursive: true });
  try {
    const metadata = await request(url, 'HEAD', {}, resolved.maxRedirects, resolved);
    const metadataStatus = metadata.statusCode ?? 500;
    if (metadataStatus < 200 || metadataStatus >= 300) {
      metadata.resume();
      throw new MofoxError('IO_ERROR', `Download metadata failed with HTTP ${metadataStatus}`);
    }
    const lengthHeader = metadata.headers['content-length'];
    const totalBytes = lengthHeader === undefined ? 0 : Number(lengthHeader);
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
      metadata.resume();
      throw new MofoxError('IO_ERROR', 'Download returned an invalid Content-Length');
    }
    if (totalBytes > resolved.maxBytes) {
      metadata.resume();
      throw new MofoxError('IO_ERROR', 'Download exceeds the configured size limit');
    }
    const supportsRanges = metadata.headers['accept-ranges'] === 'bytes';
    metadata.resume();
    const report = createProgressReporter(url, totalBytes, onProgress);

    // 不可信的长度、小文件或不支持 Range 时保持单流，避免产生无效的分段请求。
    if (!supportsRanges || !Number.isFinite(totalBytes) || totalBytes < resolved.minChunkBytes) {
      await downloadSingle(url, destination, totalBytes, resolved, report);
    } else {
      await downloadChunks(url, destination, totalBytes, resolved, report);
    }
    report(totalBytes, true);
  } catch (error) {
    // 下载失败或取消时移除不完整文件，避免调用方误将其视为有效产物。
    await rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * 使用单流下载完整资源。
 *
 * @param url - 资源的完整 URL。
 * @param destination - 本地目标文件路径。
 * @param totalBytes - 已知的内容长度（可能为 0）。
 * @param options - 解析后的下载选项。
 * @param report - 进度上报函数。
 * @throws {MofoxError} HTTP 状态码 >= 400 时抛出 `IO_ERROR`。
 */
async function downloadSingle(
  url: string,
  destination: string,
  totalBytes: number,
  options: ResolvedOptions,
  report: (receivedBytes: number, force?: boolean) => void,
): Promise<void> {
  const response = await request(url, 'GET', {}, options.maxRedirects, options);
  if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
    const status = response.statusCode ?? 500;
    response.resume();
    throw new MofoxError(
      'IO_ERROR',
      `Download failed with HTTP ${status}（${describeNetworkError(status)}）`,
    );
  }
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > options.maxBytes || (totalBytes > 0 && received > totalBytes)) {
        callback(
          new MofoxError('IO_ERROR', 'Download body exceeds its declared or configured size'),
        );
        return;
      }
      report(received);
      callback(null, chunk);
    },
  });
  await pipeline(response, meter, createWriteStream(destination), { signal: options.signal });
  if (totalBytes > 0 && received !== totalBytes) {
    throw new MofoxError('IO_ERROR', 'Download body length did not match Content-Length');
  }
  report(totalBytes || received, true);
}

/**
 * 预分配文件后按字节范围并发下载各分片。
 *
 * 各 Range 写入互不重叠的偏移区间，可安全并发执行。
 *
 * @param url - 资源的完整 URL。
 * @param destination - 本地目标文件路径。
 * @param totalBytes - 已知的内容长度。
 * @param options - 解析后的下载选项。
 * @param report - 进度上报函数。
 * @throws {MofoxError} 服务端拒绝 Range 或返回长度不符时抛出 `IO_ERROR`。
 */
async function downloadChunks(
  url: string,
  destination: string,
  totalBytes: number,
  options: ResolvedOptions,
  report: (receivedBytes: number, force?: boolean) => void,
): Promise<void> {
  // 预分配同一个文件后，各 Range 写入互不重叠的偏移区间，可安全并发执行。
  const handle = await open(destination, 'w');
  let received = 0;
  const cancellation = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, cancellation.signal])
    : cancellation.signal;
  let firstError: unknown;
  try {
    await handle.truncate(totalBytes);
    const chunkSize = Math.max(options.minChunkBytes, Math.ceil(totalBytes / options.concurrency));
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < totalBytes; start += chunkSize) {
      ranges.push({ start, end: Math.min(totalBytes - 1, start + chunkSize - 1) });
    }
    const results = await Promise.allSettled(
      ranges.map(async ({ start, end }) => {
        try {
          const response = await request(
            url,
            'GET',
            { Range: `bytes=${start}-${end}` },
            options.maxRedirects,
            { ...options, signal },
          );
          if (response.statusCode !== 206) {
            response.resume();
            throw new MofoxError('IO_ERROR', 'Server rejected a Range request');
          }
          const expectedContentRange = `bytes ${start}-${end}/${totalBytes}`;
          if (response.headers['content-range'] !== expectedContentRange) {
            response.resume();
            throw new MofoxError('IO_ERROR', 'Range response metadata did not match the request');
          }
          let position = start;
          for await (const rawChunk of response) {
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            if (position + chunk.length > end + 1)
              throw new MofoxError('IO_ERROR', 'Range response exceeds the requested size');
            let offset = 0;
            while (offset < chunk.length) {
              const { bytesWritten } = await handle.write(
                chunk,
                offset,
                chunk.length - offset,
                position + offset,
              );
              if (!bytesWritten) throw new MofoxError('IO_ERROR', 'Unable to write download chunk');
              offset += bytesWritten;
            }
            position += chunk.length;
            received += chunk.length;
            report(received);
          }
          if (position !== end + 1)
            throw new MofoxError('IO_ERROR', 'Range response length did not match');
        } catch (error) {
          firstError ??= error;
          cancellation.abort();
          throw error;
        }
      }),
    );
    if (results.some((result) => result.status === 'rejected')) throw firstError;
  } finally {
    await handle.close();
  }
}

/**
 * 发起 HTTP/HTTPS 请求并自动处理重定向。
 *
 * 重定向时先消费当前响应再递归发起下一跳，防止重定向链残留套接字。
 *
 * @param url - 请求 URL。
 * @param method - HTTP 方法（HEAD 或 GET）。
 * @param headers - 请求头。
 * @param redirectsRemaining - 剩余可用重定向次数。
 * @param signal - 可选的取消信号。
 * @returns IncomingMessage 响应流。
 * @throws {MofoxError} 重定向次数耗尽时抛出 `IO_ERROR`。
 */
function request(
  url: string,
  method: 'HEAD' | 'GET',
  headers: Record<string, string>,
  redirectsRemaining: number,
  options: ResolvedOptions,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = validateDownloadUrl(url, options);
    } catch (error) {
      reject(error);
      return;
    }
    const requestOptions: RequestOptions = { method, headers, signal: options.signal };
    const makeRequest = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = makeRequest(parsed, requestOptions, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        // 先消费当前响应，再递归发起下一跳，防止重定向链残留套接字。
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new MofoxError('IO_ERROR', 'Download redirect limit exceeded'));
          return;
        }
        let redirected: string;
        try {
          redirected = new URL(location, parsed).toString();
          validateDownloadUrl(redirected, options);
        } catch (error) {
          reject(error);
          return;
        }
        request(redirected, method, headers, redirectsRemaining - 1, options).then(resolve, reject);
        return;
      }
      if (status >= 300 && status < 400) {
        response.resume();
        reject(new MofoxError('IO_ERROR', 'Download redirect did not include a destination'));
        return;
      }
      resolve(response);
    });
    outgoing.once('error', (error) => {
      // 取消信号触发的错误原样上抛，避免把用户主动取消误报为网络故障。
      if (options.signal?.aborted) {
        reject(error);
        return;
      }
      reject(new MofoxError('IO_ERROR', `网络请求失败: ${describeNetworkError(error)}`));
    });
    outgoing.setTimeout(30_000, () => outgoing.destroy(new Error('Download connection timed out')));
    outgoing.end();
  });
}

/**
 * 校验并归一化下载选项，填充默认值。
 *
 * @param options - 原始下载选项。
 * @returns 包含 concurrency/minChunkBytes/maxRedirects 的解析后选项。
 * @throws {MofoxError} 任一参数越界时抛出 `INVALID_ARGUMENT`。
 */
function resolveOptions(url: string, options: SecureRangeDownloadOptions): ResolvedOptions {
  const concurrency = options.concurrency ?? 8;
  const minChunkBytes = options.minChunkBytes ?? 32 * 1_048_576;
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxBytes ?? 4 * 1024 ** 3;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new MofoxError('INVALID_ARGUMENT', 'Download concurrency must be between 1 and 64');
  }
  if (!Number.isInteger(minChunkBytes) || minChunkBytes < 1) {
    throw new MofoxError('INVALID_ARGUMENT', 'Minimum chunk size must be positive');
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 20) {
    throw new MofoxError('INVALID_ARGUMENT', 'Redirect limit must be between 0 and 20');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new MofoxError('INVALID_ARGUMENT', 'Download size limit must be a positive integer');
  }
  let initial: URL;
  try {
    initial = new URL(url);
  } catch {
    throw new MofoxError('INVALID_ARGUMENT', 'Download URL is invalid');
  }
  const allowedHosts = new Set([
    initial.hostname.toLowerCase(),
    ...(options.allowedRedirectHosts ?? []).map((host) => host.toLowerCase()),
  ]);
  const resolved: ResolvedOptions = {
    concurrency,
    minChunkBytes,
    maxRedirects,
    maxBytes,
    allowedHosts,
    allowInsecureHttp: options.allowInsecureHttp === true,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  validateDownloadUrl(initial.toString(), resolved);
  return resolved;
}

function validateDownloadUrl(value: string, options: ResolvedOptions): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MofoxError('IO_ERROR', 'Download redirect URL is invalid');
  }
  if (url.username || url.password) {
    throw new MofoxError('IO_ERROR', 'Download URLs must not contain credentials');
  }
  if (url.protocol !== 'https:' && !(options.allowInsecureHttp && url.protocol === 'http:')) {
    throw new MofoxError('IO_ERROR', 'Download refused an insecure URL or redirect');
  }
  if (!options.allowedHosts.has(url.hostname.toLowerCase())) {
    throw new MofoxError('IO_ERROR', `Download redirect host is not allowed: ${url.hostname}`);
  }
  return url;
}

/**
 * 创建按时间与百分比双阈值节流的进度上报函数。
 *
 * 在高并发分段写入时避免过频回调，完成状态始终强制上报。
 *
 * @param url - 资源 URL，用于进度事件载荷。
 * @param totalBytes - 已知的内容长度。
 * @param listener - 可选的进度监听器。
 * @returns 内部使用的上报函数。
 */
function createProgressReporter(
  url: string,
  totalBytes: number,
  listener?: ProgressListener,
): (receivedBytes: number, force?: boolean) => void {
  const startedAt = performance.now();
  let lastReportedAt = 0;
  let lastPercent = -1;
  return (receivedBytes, force = false) => {
    if (!listener) return;
    const now = performance.now();
    const percent = totalBytes > 0 ? Math.floor((receivedBytes / totalBytes) * 100) : 0;
    // 在高并发分段写入时按时间和百分比双阈值节流，完成状态始终强制上报。
    if (!force && now - lastReportedAt < 200 && percent - lastPercent < 1) return;
    lastReportedAt = now;
    lastPercent = percent;
    listener({
      url,
      receivedBytes,
      totalBytes,
      bytesPerSecond: Math.round(receivedBytes / Math.max(0.001, (now - startedAt) / 1_000)),
    });
  };
}
