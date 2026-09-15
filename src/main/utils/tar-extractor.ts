import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import * as tar from 'tar-stream';

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface ArchiveExtractionLimits {
  maxEntries?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxCompressionRatio?: number;
}

const DEFAULT_LIMITS: Required<ArchiveExtractionLimits> = {
  maxEntries: 50_000,
  maxFileBytes: 2 * 1024 ** 3,
  maxTotalBytes: 8 * 1024 ** 3,
  maxCompressionRatio: 500,
};

/** 安全流式解压 tar.gz；拒绝越界路径、链接、特殊文件和超限/高压缩率归档。 */
export async function extractTarGzSecurely(
  archivePath: string,
  destinationDirectory: string,
  options: ArchiveExtractionLimits & { signal?: AbortSignal } = {},
): Promise<void> {
  const { signal, ...limitOptions } = options;
  const limits = resolveLimits(limitOptions);
  signal?.throwIfAborted();
  const archiveBytes = (await stat(archivePath)).size;
  if (archiveBytes <= 0 || archiveBytes > limits.maxTotalBytes) {
    throw new Error('拒绝大小异常的 tar.gz 归档');
  }

  const requestedRoot = resolve(destinationDirectory);
  await mkdir(requestedRoot, { recursive: true });
  const rootStats = await lstat(requestedRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`tar.gz 解压目标不是安全的普通目录：${requestedRoot}`);
  }
  const root = await realpath(requestedRoot);
  const maximumExpandedBytes = Math.min(
    limits.maxTotalBytes,
    archiveBytes * limits.maxCompressionRatio,
  );
  const extractor = tar.extract({ allowUnknownFormat: false });
  let entryCount = 0;
  let declaredBytes = 0;
  let writtenBytes = 0;
  let expandedStreamBytes = 0;

  extractor.on('entry', (header, stream, next) => {
    // 校验可能在 pipeline 接管该条目之前失败，错误仍需由总流统一结算。
    stream.on('error', (error) => extractor.destroy(error));
    void (async () => {
      entryCount += 1;
      if (entryCount > limits.maxEntries) throw unsafeEntry(header.name, '条目数量超过限制');
      const type = header.type ?? 'file';
      if (type !== 'file' && type !== 'directory') {
        throw unsafeEntry(header.name, `不允许解压 ${type} 条目`);
      }

      if (type === 'directory' && /^\.(?:\/)?$/.test(header.name)) {
        stream.resume();
        await finished(stream);
        return;
      }
      const segments = safeEntrySegments(header.name);
      if (type === 'directory') {
        await ensureSafeDirectories(root, segments);
        stream.resume();
        await finished(stream);
        return;
      }

      const size = header.size ?? 0;
      if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxFileBytes) {
        throw unsafeEntry(header.name, '单文件声明大小超过限制');
      }
      declaredBytes += size;
      if (declaredBytes > maximumExpandedBytes) {
        throw unsafeEntry(header.name, '归档展开大小或压缩率超过限制');
      }

      await ensureSafeDirectories(root, segments.slice(0, -1));
      const target = resolveInside(root, segments, header.name);
      await prepareOutputFile(target, header.name);
      let entryBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          entryBytes += chunk.length;
          writtenBytes += chunk.length;
          if (entryBytes > size || writtenBytes > maximumExpandedBytes) {
            callback(unsafeEntry(header.name, '实际展开大小超过归档声明或安全限制'));
            return;
          }
          callback(null, chunk);
        },
      });
      const output = createWriteStream(target, {
        flags: 'wx',
        mode: (header.mode ?? 0o666) & 0o777,
      });
      try {
        await pipeline(
          stream,
          meter,
          output,
          ...(options.signal ? [{ signal: options.signal }] : []),
        );
        if (entryBytes !== size) throw unsafeEntry(header.name, '实际展开大小与归档声明不一致');
      } catch (error) {
        await rm(target, { force: true }).catch(() => undefined);
        throw error;
      }
    })().then(
      () => next(),
      (error) => {
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
        next(error);
      },
    );
  });

  await pipeline(
    createReadStream(archivePath),
    createGunzip(),
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        expandedStreamBytes += chunk.length;
        callback(
          expandedStreamBytes > maximumExpandedBytes + limits.maxEntries * 1024
            ? new Error('tar.gz 展开数据流超过安全限制')
            : null,
          chunk,
        );
      },
    }),
    extractor,
    ...(options.signal ? [{ signal: options.signal }] : []),
  );
}

function resolveLimits(options: ArchiveExtractionLimits): Required<ArchiveExtractionLimits> {
  const resolved = { ...DEFAULT_LIMITS, ...options };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`归档安全限制 ${name} 必须是正整数`);
    }
  }
  return resolved;
}

function unsafeEntry(entryName: string, reason: string): Error {
  const printable = [...entryName]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? '\ufffd' : character;
    })
    .join('');
  return new Error(`拒绝不安全的 tar.gz 条目“${printable}”：${reason}`);
}

function safeEntrySegments(entryName: string): string[] {
  if (entryName.length > 4096 || entryName.includes('\0')) {
    throw unsafeEntry(entryName, '条目名无效或过长');
  }
  const normalized = entryName.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//')) {
    throw unsafeEntry(entryName, '条目路径必须是非空相对路径');
  }
  if (/^[a-z]:/i.test(normalized)) throw unsafeEntry(entryName, '不允许包含 Windows 盘符');
  const segments: string[] = [];
  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') throw unsafeEntry(entryName, '不允许使用上级目录');
    if (segment.includes(':')) throw unsafeEntry(entryName, '不允许使用 NTFS 数据流路径');
    if (/[. ]$/.test(segment) || WINDOWS_RESERVED_NAME.test(segment)) {
      throw unsafeEntry(entryName, '路径段在 Windows 上不安全');
    }
    segments.push(segment);
  }
  if (segments.length === 0 || segments.length > 128) {
    throw unsafeEntry(entryName, '条目路径为空或嵌套过深');
  }
  return segments;
}

function resolveInside(root: string, segments: readonly string[], entryName: string): string {
  const target = resolve(root, ...segments);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw unsafeEntry(entryName, '条目解析到了目标目录之外');
  }
  return target;
}

async function ensureSafeDirectories(root: string, segments: readonly string[]): Promise<void> {
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`tar.gz 解压目标包含不安全的路径节点：${current}`);
      }
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if (!hasErrorCode(mkdirError, 'EEXIST')) throw mkdirError;
        const stats = await lstat(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw mkdirError;
      }
    }
  }
}

async function prepareOutputFile(target: string, entryName: string): Promise<void> {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw unsafeEntry(entryName, '目标位置不是普通文件');
    }
    await rm(target, { force: true });
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
