import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualImportService } from '../../../src/main/services/manual-import-service';
import type { CreateInstanceInput } from '../../../src/shared/domain/instance';
import type { BotPlatform } from '../../../src/shared/domain/bot-platform';
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

/** 构造可被平台启动入口探测的目录，并在导入时通过该 mock 平台核验。 */
async function createPlatformDirectory(root: string, name: string): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.mjs'), 'export {}');
  return directory;
}

function createFakePlatform(id: string, name: string): BotPlatform {
  return {
    id,
    name,
    description: `${name} 平台`,
    supportedPlatforms: ['linux', 'win32'],
    supportedArch: ['x64'],
    async isAvailable() {
      return { available: true, requirements: [] };
    },
    async install() {
      throw new Error('unused');
    },
    async configure() {},
    async getLatestVersion() {
      return '1.0.0';
    },
    async update() {
      throw new Error('unused');
    },
    async getStartCommand(platformPath: string) {
      const entry = join(platformPath, 'index.mjs');
      try {
        await access(entry);
      } catch {
        throw new Error(`missing ${entry}`);
      }
      return { command: 'node', args: [entry], cwd: platformPath };
    },
  };
}

/** 构造按 ID 查找平台的解析器；查找失败即模拟导入时的未知平台错误。 */
function createPlatformResolver(
  platforms: BotPlatform[] = [],
): { get(platformId: string): BotPlatform } {
  return {
    get(platformId: string): BotPlatform {
      const platform = platforms.find((candidate) => candidate.id === platformId);
      if (!platform) throw new Error(`unknown platform ${platformId}`);
      return platform;
    },
  };
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
    const platformDirectory = await createPlatformDirectory(root, 'napcat');
    const instances: Instance[] = [];
    const repository = {
      list: vi.fn(async () => [...instances]),
      create: vi.fn(async (input: CreateInstanceInput) => {
        const instance: Instance = {
          ...DEFAULT_INSTANCE,
          ...input,
          id: `mofox-${instances.length + 1}`,
          platform: input.platform ?? { id: null, installDir: null, version: null },
          createdAt: Date.now(),
        };
        instances.push(instance);
        return instance;
      }),
    };
    const service = new ManualImportService(
      repository,
      createPlatformResolver([createFakePlatform('napcat', 'NapCat')]),
    );

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
    const service = new ManualImportService(repository, createPlatformResolver());

    await expect(
      service.importInstance({ instanceName: '无效实例', mofoxInstallDir: root }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('retries the platform directory check at import time and rejects an unstartable platform', async () => {
    const root = await createTemporaryDirectory();
    const mofoxDirectory = await createMofoxDirectory(root);
    // 目录存在但不含平台启动入口。
    const platformDirectory = join(root, 'napcat');
    await mkdir(platformDirectory);
    const repository = { list: vi.fn(async () => []), create: vi.fn() };
    const service = new ManualImportService(
      repository,
      createPlatformResolver([createFakePlatform('napcat', 'NapCat')]),
    );

    await expect(
      service.importInstance({
        instanceName: '平台无效',
        mofoxInstallDir: mofoxDirectory,
        platformId: 'napcat',
        platformDir: platformDirectory,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('inspects a platform directory against its own start entry', async () => {
    const root = await createTemporaryDirectory();
    const platformDirectory = await createPlatformDirectory(root, 'snowluma');
    const service = new ManualImportService(
      { list: vi.fn(async () => []), create: vi.fn() },
      createPlatformResolver([createFakePlatform('snowluma', 'SnowLuma')]),
    );

    await expect(
      service.inspectPlatformPath('snowluma', platformDirectory),
    ).resolves.toMatchObject({ absolute: true, exists: true, isDirectory: true, valid: true });

    await expect(
      service.inspectPlatformPath('snowluma', join(root, 'missing')),
    ).resolves.toMatchObject({ exists: false, isDirectory: false, valid: false });
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
          platform: { id: null, installDir: null, version: null },
          status: 'stopped' as const,
          createdAt: 1,
          lastStartedAt: null,
          autoStart: false,
        },
      ]),
      create: vi.fn(),
    };
    const service = new ManualImportService(repository, createPlatformResolver());

    await expect(
      service.importInstance({ instanceName: '重复实例', mofoxInstallDir: mofoxDirectory }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('requires the platform ID and directory to be provided together', async () => {
    const root = await createTemporaryDirectory();
    const mofoxDirectory = await createMofoxDirectory(root);
    const repository = { list: vi.fn(async () => []), create: vi.fn() };
    const service = new ManualImportService(repository, createPlatformResolver());

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
