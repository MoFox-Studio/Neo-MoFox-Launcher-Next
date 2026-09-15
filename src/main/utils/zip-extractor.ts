import { createWriteStream } from 'node:fs';
import { lstat, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import type { ArchiveExtractionLimits } from './tar-extractor';

const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMBOLIC_LINK = 0o120000;
const DOS_DIRECTORY_ATTRIBUTE = 0x10;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const DEFAULT_LIMITS: Required<ArchiveExtractionLimits> = {
  maxEntries: 50_000,
  maxFileBytes: 2 * 1024 ** 3,
  maxTotalBytes: 8 * 1024 ** 3,
  maxCompressionRatio: 500,
};

/** 判断 Node 文件系统错误是否带有指定错误码。 */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** 构造包含条目名的拒绝原因，便于安装日志定位恶意或损坏的压缩包。 */
function unsafeEntry(entryName: string, reason: string): Error {
  const printableName = [...entryName]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? '\ufffd' : character;
    })
    .join('');
  return new Error(`拒绝不安全的 ZIP 条目“${printableName}”：${reason}`);
}

/**
 * 将 ZIP 内部的 POSIX 风格路径转换为安全的相对路径段。
 *
 * yauzl 已执行基础文件名校验；这里额外拒绝 Windows 盘符、NTFS ADS、设备名以及
 * 会在 Windows 上被折叠的尾随空格/句点，避免跨平台路径解释差异造成越界写入。
 */
function safeEntrySegments(entryName: string): string[] {
  if (entryName.length > 4096 || entryName.includes('\0')) {
    throw unsafeEntry(entryName, '条目名无效或过长');
  }
  const normalized = entryName.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.startsWith('//')) {
    throw unsafeEntry(entryName, '条目路径必须是非空相对路径');
  }
  if (/^[a-z]:/i.test(normalized)) throw unsafeEntry(entryName, '不允许包含 Windows 盘符');

  const rawSegments = normalized.split('/');
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') throw unsafeEntry(entryName, '不允许使用上级目录');
    if (segment.includes(':')) throw unsafeEntry(entryName, '不允许使用 NTFS 数据流路径');
    if (/[. ]$/.test(segment)) {
      throw unsafeEntry(entryName, 'Windows 路径段不能以空格或句点结尾');
    }
    if (WINDOWS_RESERVED_NAME.test(segment)) {
      throw unsafeEntry(entryName, '不允许使用 Windows 设备名');
    }
    segments.push(segment);
  }

  if (segments.length === 0 || segments.length > 128) {
    throw unsafeEntry(entryName, '条目路径为空或嵌套过深');
  }
  return segments;
}

/** 将已校验路径限制在真实目标根目录中，作为路径解析的第二道边界检查。 */
function resolveInside(root: string, segments: readonly string[], entryName: string): string {
  const target = resolve(root, ...segments);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw unsafeEntry(entryName, '条目解析到了目标目录之外');
  }
  return target;
}

/** 逐级创建目录，并拒绝目标树中预先存在的符号链接或普通文件。 */
async function ensureSafeDirectories(root: string, segments: readonly string[]): Promise<void> {
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error(`ZIP 解压目标包含不安全的路径节点：${current}`);
      }
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        // 并发创建时只接受最终确实为普通目录的结果。
        if (!hasErrorCode(mkdirError, 'EEXIST')) throw mkdirError;
        const stats = await lstat(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw mkdirError;
      }
    }
  }
}

/** 从 ZIP 外部属性中读取 Unix 文件类型；0 表示归档没有提供该信息。 */
function unixFileType(entry: yauzl.Entry): number {
  return (entry.externalFileAttributes >>> 16) & UNIX_FILE_TYPE_MASK;
}

/** 判断条目是否表示目录，同时兼容 Unix mode、DOS 属性与标准尾斜杠。 */
function isDirectoryEntry(entry: yauzl.Entry, fileType: number): boolean {
  return (
    entry.fileName.endsWith('/') ||
    fileType === UNIX_DIRECTORY ||
    (entry.externalFileAttributes & DOS_DIRECTORY_ATTRIBUTE) !== 0
  );
}

/** 在写入前拒绝符号链接、设备节点及目标目录中的同名链接。 */
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

/**
 * 将 ZIP 安全地流式解压到指定目录。
 *
 * 路径在写入前会同时经过归档名校验和真实目标根边界检查；ZIP 中的符号链接与
 * 特殊文件一律拒绝。文件使用独占创建，避免检查与写入之间被符号链接替换。
 */
export async function extractZipSecurely(
  zipPath: string,
  destinationDirectory: string,
  options: ArchiveExtractionLimits = {},
): Promise<void> {
  const limits = resolveLimits(options);
  const archiveBytes = (await stat(zipPath)).size;
  if (archiveBytes <= 0 || archiveBytes > limits.maxTotalBytes) {
    throw new Error('拒绝大小异常的 ZIP 归档');
  }
  const maximumExpandedBytes = Math.min(
    limits.maxTotalBytes,
    Math.max(64 * 1024 ** 2, archiveBytes * limits.maxCompressionRatio),
  );
  const requestedRoot = resolve(destinationDirectory);
  await mkdir(requestedRoot, { recursive: true });
  const rootStats = await lstat(requestedRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`ZIP 解压目标不是安全的普通目录：${requestedRoot}`);
  }
  const root = await realpath(requestedRoot);
  const zipFile = await yauzl.openPromise(zipPath, {
    decodeStrings: true,
    validateEntrySizes: true,
    // 兼容旧版 .NET 生成的反斜杠条目；yauzl 会先转换为正斜杠再进行安全校验。
    strictFileNames: false,
  });
  let entryCount = 0;
  let expandedBytes = 0;

  for await (const entry of zipFile.eachEntry()) {
    entryCount += 1;
    if (entryCount > limits.maxEntries) {
      throw unsafeEntry(entry.fileName, '条目数量超过限制');
    }
    if (
      !Number.isSafeInteger(entry.uncompressedSize) ||
      entry.uncompressedSize < 0 ||
      entry.uncompressedSize > limits.maxFileBytes
    ) {
      throw unsafeEntry(entry.fileName, '单文件声明大小超过限制');
    }
    expandedBytes += entry.uncompressedSize;
    if (expandedBytes > maximumExpandedBytes) {
      throw unsafeEntry(entry.fileName, '归档展开大小或压缩率超过限制');
    }
    const fileType = unixFileType(entry);
    if (fileType === UNIX_SYMBOLIC_LINK) {
      throw unsafeEntry(entry.fileName, '不允许解压符号链接');
    }
    if (fileType !== 0 && fileType !== UNIX_REGULAR_FILE && fileType !== UNIX_DIRECTORY) {
      throw unsafeEntry(entry.fileName, '不允许解压设备节点或其他特殊文件');
    }

    const segments = safeEntrySegments(entry.fileName);
    const directory = isDirectoryEntry(entry, fileType);
    if (directory) {
      await ensureSafeDirectories(root, segments);
      continue;
    }

    await ensureSafeDirectories(root, segments.slice(0, -1));
    const target = resolveInside(root, segments, entry.fileName);
    await prepareOutputFile(target, entry.fileName);
    const readStream = await zipFile.openReadStreamPromise(entry);
    const unixMode = (entry.externalFileAttributes >>> 16) & 0o777;
    const writeStream = createWriteStream(target, {
      flags: 'wx',
      mode: unixMode || 0o666,
    });
    try {
      await pipeline(readStream, writeStream);
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
  }
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
