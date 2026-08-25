import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectPath,
  requireDirectory,
  requireFile,
  samePath,
} from '../../../src/main/utils/path-inspection';

/** 覆盖目录/文件存在性检查与路径探测，这些逻辑由手动导入与实例管理共用。 */
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-path-inspection-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('requireDirectory', () => {
  it('returns the resolved absolute path for an existing directory', async () => {
    const root = await createTemporaryDirectory();
    const target = join(root, 'dir');
    await mkdir(target);

    await expect(requireDirectory(target, '目录')).resolves.toBe(target);
  });

  it('rejects empty, relative, missing and non-directory inputs', async () => {
    const root = await createTemporaryDirectory();
    const file = join(root, 'file.txt');
    await writeFile(file, 'x');

    await expect(requireDirectory('', '目录')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(requireDirectory('relative/path', '目录')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(requireDirectory(join(root, 'missing'), '目录')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(requireDirectory(file, '目录')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

describe('requireFile', () => {
  it('accepts an existing file and rejects a missing one', async () => {
    const root = await createTemporaryDirectory();
    const file = join(root, 'main.py');
    await writeFile(file, 'print("hello")');

    await expect(requireFile(file, '缺少文件')).resolves.toBeUndefined();
    await expect(requireFile(join(root, 'nope.py'), '缺少文件')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('inspectPath', () => {
  it('reports absoluteness, existence, directory type and the main.py flag', async () => {
    const root = await createTemporaryDirectory();
    const mofoxDir = join(root, 'mofox');
    await mkdir(mofoxDir);
    await writeFile(join(mofoxDir, 'main.py'), 'print("hello")');
    const emptyDir = join(root, 'empty');
    await mkdir(emptyDir);

    await expect(inspectPath(mofoxDir)).resolves.toEqual({
      absolute: true,
      exists: true,
      isDirectory: true,
      mainPyExists: true,
    });
    await expect(inspectPath(emptyDir)).resolves.toEqual({
      absolute: true,
      exists: true,
      isDirectory: true,
      mainPyExists: false,
    });
    await expect(inspectPath(join(root, 'missing'))).resolves.toEqual({
      absolute: true,
      exists: false,
      isDirectory: false,
      mainPyExists: false,
    });
    await expect(inspectPath('relative')).resolves.toEqual({
      absolute: false,
      exists: false,
      isDirectory: false,
      mainPyExists: false,
    });
  });
});

describe('samePath', () => {
  it('compares paths after normalization', () => {
    const root = process.cwd();
    expect(samePath(join(root, 'a', '..', 'b'), join(root, 'b'))).toBe(true);
    expect(samePath(join(root, 'a'), join(root, 'b'))).toBe(false);
  });
});
