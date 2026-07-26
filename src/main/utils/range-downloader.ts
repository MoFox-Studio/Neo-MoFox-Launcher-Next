import { createWriteStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { DownloadProgress, RangeDownloadOptions } from '../../shared/domain/download';
import { MofoxError } from '../../shared/domain/error';

type ProgressListener = (progress: DownloadProgress) => void;

interface ResolvedOptions {
  concurrency: number;
  minChunkBytes: number;
  maxRedirects: number;
  signal?: AbortSignal;
}

export async function downloadRange(
  url: string,
  destination: string,
  options: RangeDownloadOptions & { signal?: AbortSignal } = {},
  onProgress?: ProgressListener,
): Promise<void> {
  const resolved = resolveOptions(options);
  await mkdir(dirname(destination), { recursive: true });
  try {
    const metadata = await request(url, 'HEAD', {}, resolved.maxRedirects, resolved.signal);
    const totalBytes = Number(metadata.headers['content-length'] ?? 0);
    const supportsRanges = metadata.headers['accept-ranges'] === 'bytes';
    metadata.resume();
    const report = createProgressReporter(url, totalBytes, onProgress);

    if (!supportsRanges || !Number.isFinite(totalBytes) || totalBytes < resolved.minChunkBytes) {
      await downloadSingle(url, destination, totalBytes, resolved, report);
    } else {
      await downloadChunks(url, destination, totalBytes, resolved, report);
    }
    report(totalBytes, true);
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function downloadSingle(
  url: string,
  destination: string,
  totalBytes: number,
  options: ResolvedOptions,
  report: (receivedBytes: number, force?: boolean) => void,
): Promise<void> {
  const response = await request(url, 'GET', {}, options.maxRedirects, options.signal);
  if ((response.statusCode ?? 500) >= 400) throw new MofoxError('IO_ERROR', `Download failed with HTTP ${response.statusCode}`);
  let received = 0;
  response.on('data', (chunk: Buffer) => {
    received += chunk.length;
    report(received);
  });
  await pipeline(response, createWriteStream(destination), { signal: options.signal });
  report(totalBytes || received, true);
}

async function downloadChunks(
  url: string,
  destination: string,
  totalBytes: number,
  options: ResolvedOptions,
  report: (receivedBytes: number, force?: boolean) => void,
): Promise<void> {
  const handle = await open(destination, 'w');
  let received = 0;
  try {
    await handle.truncate(totalBytes);
    const chunkSize = Math.max(options.minChunkBytes, Math.ceil(totalBytes / options.concurrency));
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < totalBytes; start += chunkSize) {
      ranges.push({ start, end: Math.min(totalBytes - 1, start + chunkSize - 1) });
    }
    await Promise.all(
      ranges.map(async ({ start, end }) => {
        const response = await request(
          url,
          'GET',
          { Range: `bytes=${start}-${end}` },
          options.maxRedirects,
          options.signal,
        );
        if (response.statusCode !== 206) throw new MofoxError('IO_ERROR', 'Server rejected a Range request');
        let position = start;
        for await (const rawChunk of response) {
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          await handle.write(chunk, 0, chunk.length, position);
          position += chunk.length;
          received += chunk.length;
          report(received);
        }
        if (position !== end + 1) throw new MofoxError('IO_ERROR', 'Range response length did not match');
      }),
    );
  } finally {
    await handle.close();
  }
}

function request(
  url: string,
  method: 'HEAD' | 'GET',
  headers: Record<string, string>,
  redirectsRemaining: number,
  signal?: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const requestOptions: RequestOptions = { method, headers, signal };
    const makeRequest = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = makeRequest(parsed, requestOptions, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsRemaining <= 0) {
          reject(new MofoxError('IO_ERROR', 'Download redirect limit exceeded'));
          return;
        }
        request(new URL(location, parsed).toString(), method, headers, redirectsRemaining - 1, signal)
          .then(resolve, reject);
        return;
      }
      resolve(response);
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

function resolveOptions(options: RangeDownloadOptions & { signal?: AbortSignal }): ResolvedOptions {
  const concurrency = options.concurrency ?? 8;
  const minChunkBytes = options.minChunkBytes ?? 32 * 1_048_576;
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) {
    throw new MofoxError('INVALID_ARGUMENT', 'Download concurrency must be between 1 and 64');
  }
  if (!Number.isInteger(minChunkBytes) || minChunkBytes < 1) {
    throw new MofoxError('INVALID_ARGUMENT', 'Minimum chunk size must be positive');
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 20) {
    throw new MofoxError('INVALID_ARGUMENT', 'Redirect limit must be between 0 and 20');
  }
  return { concurrency, minChunkBytes, maxRedirects, ...(options.signal ? { signal: options.signal } : {}) };
}

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