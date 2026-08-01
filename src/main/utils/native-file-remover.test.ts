import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removePathSafe } from './native-file-remover';

const directories: string[] = [];

// 测试仅在临时目录内创建文件，清理函数保持幂等以容忍用例已删除目标。
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('removePathSafe', () => {
  // 覆盖嵌套目录删除和根目录、工作目录等危险目标的拒绝策略。
  it('removes nested files idempotently', async () => {
    const root = await mkdtemp(join(process.cwd(), '.test-remove-'));
    directories.push(root);
    const target = join(root, 'nested');
    await mkdir(target);
    await writeFile(join(target, 'file.txt'), 'data');

    await removePathSafe(target);
    await expect(removePathSafe(target)).resolves.toBeUndefined();
  });

  it.each(['', '.', process.cwd()])('refuses unsafe deletion targets: %s', async (target) => {
    await expect(removePathSafe(target)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
