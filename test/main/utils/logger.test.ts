import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../../src/main/utils/logger';

const directories: string[] = [];

// 日志测试使用隔离目录，防止轮转和读取结果污染开发环境中的真实日志。
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('logger', () => {
  // 覆盖结构化追加后的顺序读取，以及 scope 进入文件路径前的净化逻辑。
  it('writes and reads structured entries in chronological order', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.test-logger-'));
    directories.push(directory);
    const logger = createLogger({
      directory,
      getSettings: async () => ({ maxFileSizeMb: 1, maxArchiveDays: 14, compressLogArchive: true }),
    });

    await logger.log('launcher', 'info', 'started');
    await logger.log('launcher', 'warn', 'warning');

    await expect(logger.read('launcher')).resolves.toEqual([
      expect.objectContaining({ level: 'info', scope: 'launcher', message: 'started' }),
      expect.objectContaining({ level: 'warn', scope: 'launcher', message: 'warning' }),
    ]);
  });

  it('sanitizes scope names instead of allowing path traversal', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.test-logger-'));
    directories.push(directory);
    const logger = createLogger({ directory });

    await logger.log('../outside', 'error', 'safe');

    await expect(logger.read('../outside')).resolves.toHaveLength(1);
  });

  // 覆盖创建日志器时的 console 挂钩：原方法保留，输出按级别镜像进 launcher 作用域。
  it('mirrors console output into the launcher scope with mapped levels', async () => {
    const directory = await mkdtemp(join(process.cwd(), '.test-logger-'));
    directories.push(directory);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createLogger({ directory });

    console.log('hello', 'world');
    console.warn('careful');
    console.error('boom', new Error('ignored'));

    // 等待镜像微任务入队后再读取，避免与串行写队列竞态。
    await new Promise((resolve) => setImmediate(resolve));
    expect(logSpy).toHaveBeenCalledWith('hello', 'world');
    expect(warnSpy).toHaveBeenCalledWith('careful');
    expect(errorSpy).toHaveBeenCalledWith('boom', expect.any(Error));
    await expect(logger.read('launcher')).resolves.toEqual([
      expect.objectContaining({ level: 'info', scope: 'launcher', message: 'hello world' }),
      expect.objectContaining({ level: 'warn', scope: 'launcher', message: 'careful' }),
      expect.objectContaining({
        level: 'error',
        scope: 'launcher',
        message: expect.stringContaining('boom'),
      }),
    ]);
  });

  // 覆盖镜像写入失败的降级路径，确保不产生未处理的 Promise 拒绝。
  it('falls back to the native console when mirroring fails', async () => {
    const blocker = await mkdtemp(join(process.cwd(), '.test-logger-'));
    directories.push(blocker);
    // 用普通文件占据日志目录路径，使 mkdir 失败从而模拟镜像写入失败。
    const occupied = join(blocker, 'occupied');
    await writeFile(occupied, 'not a directory');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    createLogger({ directory: occupied });

    console.log('hello');

    await vi.waitFor(() =>
      expect(logSpy).toHaveBeenCalledWith('无法写入控制台日志', expect.any(Error)),
    );
  });
});
