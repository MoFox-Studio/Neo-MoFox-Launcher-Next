import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { LogEntry, LogLevel } from '../../shared/domain/logger';

// 基于按作用域 JSON Lines 文件的主进程日志器，负责串行写入、轮转和过期归档清理。
interface LoggerSettings {
  maxFileSizeMb: number;
  maxArchiveDays: number;
  compressLogArchive: boolean;
}

interface LoggerOptions {
  directory: string;
  getSettings?: () => Promise<LoggerSettings>;
}

export interface Logger {
  log(scope: string, level: LogLevel, message: string): Promise<LogEntry>;
  read(scope: string, limit?: number): Promise<LogEntry[]>;
}

const gzipAsync = promisify(gzip);
const DEFAULT_LOGGER_SETTINGS: LoggerSettings = {
  maxFileSizeMb: 16,
  maxArchiveDays: 14,
  compressLogArchive: true,
};

/**
 * 创建基于按作用域 JSON Lines 文件的主进程日志器。
 *
 * 同一实例的写入及后续读取共用串行队列，避免轮转、追加和读取在文件系统层面交错。
 *
 * @param options - 日志目录与可选的运行时设置回调。
 * @returns 暴露 `log` 与 `read` 方法的 Logger 对象。
 */
export function createLogger(options: LoggerOptions): Logger {
  // 同一实例的写入及后续读取共用队列，避免轮转、追加和读取在文件系统层面交错。
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    async log(scope, level, message) {
      const entry: LogEntry = { timestamp: Date.now(), level, scope: sanitizeScope(scope), message };
      const operation = writeQueue.then(async () => {
        await mkdir(options.directory, { recursive: true });
        const path = logPath(options.directory, scope);
        const settings = options.getSettings
          ? { ...DEFAULT_LOGGER_SETTINGS, ...(await options.getSettings()) }
          : DEFAULT_LOGGER_SETTINGS;
        await rotateIfNeeded(path, settings);
        await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
        await removeExpiredArchives(options.directory, settings.maxArchiveDays);
      });
      writeQueue = operation.catch(() => undefined);
      await operation;
      return entry;
    },

    async read(scope, limit = 1_000) {
      await writeQueue;
      try {
        const lines = (await readFile(logPath(options.directory, scope), 'utf8'))
          .split(/\r?\n/)
          .filter(Boolean);
        return lines
          .slice(-Math.max(0, limit))
          .map((line) => JSON.parse(line) as LogEntry)
          .filter(isLogEntry);
      } catch (error) {
        if (isFileNotFound(error)) return [];
        throw error;
      }
    },
  };
}

/**
 * 在追加日志前检查文件大小并按需轮转。
 *
 * 先原子改名再压缩，写入方随后会创建新的活动日志文件。
 *
 * @param path - 当前活动日志路径。
 * @param settings - 包含轮转阈值与压缩开关的设置。
 */
async function rotateIfNeeded(path: string, settings: LoggerSettings): Promise<void> {
  try {
    const metadata = await stat(path);
    if (metadata.size < settings.maxFileSizeMb * 1_048_576) return;
    const archive = `${path}.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    // 先原子改名再压缩，写入方随后会创建新的活动日志文件。
    await rename(path, archive);
    if (settings.compressLogArchive) {
      await writeFile(`${archive}.gz`, await gzipAsync(await readFile(archive)));
      await rm(archive, { force: true });
    }
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }
}

/**
 * 删除超过保留期限的归档日志。
 *
 * 归档文件彼此独立，可并行读取元数据并删除；活动日志不匹配该命名规则。
 *
 * @param directory - 日志目录。
 * @param maxArchiveDays - 归档保留天数。
 */
async function removeExpiredArchives(directory: string, maxArchiveDays: number): Promise<void> {
  const cutoff = Date.now() - maxArchiveDays * 86_400_000;
  const files = await readdir(directory, { withFileTypes: true });
  // 归档文件彼此独立，可并行读取元数据并删除，活动日志不匹配该命名规则。
  await Promise.all(
    files
      .filter((file) => file.isFile() && /\.log\..+/.test(file.name))
      .map(async (file) => {
        const path = join(directory, file.name);
        if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
      }),
  );
}

/**
 * 拼接日志目录与作用域文件名。
 *
 * @param directory - 日志目录。
 * @param scope - 已经过滤的日志作用域。
 * @returns `<directory>/<scope>.log` 形式的路径。
 */
function logPath(directory: string, scope: string): string {
  return join(directory, `${sanitizeScope(scope)}.log`);
}

/**
 * 规范化日志作用域，仅保留文件名安全字符以阻断目录穿越。
 *
 * @param scope - 原始作用域字符串。
 * @returns 安全的作用域字符串；空值回退为 `launcher`。
 */
function sanitizeScope(scope: string): string {
  // scope 最终参与路径拼接，仅保留文件名安全字符以阻断目录穿越。
  return scope.replace(/[^a-z0-9._-]+/gi, '_').replace(/^\.+/, '') || 'launcher';
}

/**
 * 判断值是否为合法的 LogEntry。
 *
 * @param value - 待判断的值。
 * @returns 字段完整时返回 `true`。
 */
function isLogEntry(value: unknown): value is LogEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LogEntry).timestamp === 'number' &&
    typeof (value as LogEntry).message === 'string'
  );
}

/**
 * 判断错误是否为文件不存在（ENOENT）错误。
 *
 * @param error - 待判断的异常对象。
 * @returns 错误码为 `ENOENT` 时返回 `true`。
 */
function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
