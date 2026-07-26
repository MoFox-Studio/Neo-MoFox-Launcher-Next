import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removePathSafe } from './native-file-remover';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('removePathSafe', () => {
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