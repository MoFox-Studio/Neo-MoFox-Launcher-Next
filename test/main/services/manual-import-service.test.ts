import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualImportService } from '../../../src/main/services/manual-import-service';
import type { CreateInstanceInput } from '../../../src/shared/domain/instance';
import { DEFAULT_INSTANCE } from '../../../src/main/utils/instance-migrations';
import type { Instance } from '../../../src/shared/domain/instance';

/** 验证已有 Neo-MoFox 目录导入时的目录检查、平台配对和重复路径保护。 */
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-manual-import-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createMofoxDirectory(root: string): Promise<string> {
  const directory = join(root, 'neo-mofox');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'main.py'), 'print("hello")');
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('ManualImportService', () => {
  it('registers an existing Neo-MoFox directory and optional platform', async () => {
    const root = await createTemporaryDirectory();
    const mofoxDirectory = await createMofoxDirectory(root);
    const platformDirectory = join(root, 'napcat');
    await mkdir(platformDirectory);
    const instances: Instance[] = [];
    const repository = {
      list: vi.fn(async () => [...instances]),
      create: vi.fn(async (input: CreateInstanceInput) => {
        const instance: Instance = {
          ...DEFAULT_INSTANCE,
          id: `mofox-${instances.length + 1}`,
          ...input,
          createdAt: Date.now(),
        };
        instances.push(instance);
        return instance;
      }),
    };
    const service = new ManualImportService(repository);

    const result = await service.importInstance({
      instanceName: '已有实例',
      mofoxInstallDir: mofoxDirectory,
      platformId: 'napcat',
      platformDir: platformDirectory,
    });

    expect(result.instanceId).toMatch(/^mofox-/);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '已有实例',
        mofoxInstallDir: resolve(mofoxDirectory),
        platform: { id: 'napcat', installDir: resolve(platformDirectory), version: null },
      }),
    );
  });

  it('rejects a directory without the Neo-MoFox entry file', async () => {
    const root = await createTemporaryDirectory();
    const repository = { list: vi.fn(async () => []), create: vi.fn() };
    const service = new ManualImportService(repository);

    await expect(
      service.importInstance({ instanceName: '无效实例', mofoxInstallDir: root }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects an already registered Neo-MoFox directory', async () => {
    const root = await createTemporaryDirectory();
    const mofoxDirectory = await createMofoxDirectory(root);
    const repository = {
      list: vi.fn(async () => [
        {
          id: 'existing',
          name: '已有实例',
          mofoxInstallDir: resolve(mofoxDirectory),
          platform: null,
          status: 'stopped' as const,
          createdAt: 1,
          lastStartedAt: null,
          autoStart: false,
        },
      ]),
      create: vi.fn(),
    };
    const service = new ManualImportService(repository);

    await expect(
      service.importInstance({ instanceName: '重复实例', mofoxInstallDir: mofoxDirectory }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('requires the platform ID and directory to be provided together', async () => {
    const root = await createTemporaryDirectory();
    const mofoxDirectory = await createMofoxDirectory(root);
    const repository = { list: vi.fn(async () => []), create: vi.fn() };
    const service = new ManualImportService(repository);

    await expect(
      service.importInstance({
        instanceName: '平台不完整',
        mofoxInstallDir: mofoxDirectory,
        platformId: 'napcat',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(repository.create).not.toHaveBeenCalled();
  });
});
