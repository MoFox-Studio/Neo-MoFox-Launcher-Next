import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from './logger';

const directories: string[] = [];

// 日志测试使用隔离目录，防止轮转和读取结果污染开发环境中的真实日志。
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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
});
