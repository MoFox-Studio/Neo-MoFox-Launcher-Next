import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import type { BotPlatform } from '../../../src/shared/domain/bot-platform';
import { InstanceManageService } from '../../../src/main/services/instance-manage-service';

/** 覆盖删除前停机、目录/记录回收、缓冲清理、打开安装目录与更新配置及路径核验。 */
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-manage-service-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createRuntime() {
  return { stop: vi.fn(async () => undefined), clearLogs: vi.fn() };
}

/** 构造带 main.py 的 MoFox 目录。 */
async function createMofoxDirectory(root: string, name = 'mofox'): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'main.py'), 'print("hello")');
  return directory;
}

/** 构造可被平台启动入口探测的目录。 */
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

function createPlatformResolver(platforms: BotPlatform[] = []): {
  get(platformId: string): BotPlatform;
} {
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
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('InstanceManageService', () => {
  it('stops, removes the directory and record, then clears logs', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const runtime = createRuntime();
    const removePath = vi.fn(async () => undefined);
    const service = new InstanceManageService(
      runtime,
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one');

    expect(runtime.stop).toHaveBeenCalledWith('one');
    expect(removePath).toHaveBeenCalledWith(instance.mofoxInstallDir);
    expect(repository.remove).toHaveBeenCalledWith('one');
    expect(runtime.clearLogs).toHaveBeenCalledWith('one');
  });

  it('opens the MoFox install directory in the file manager', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const openPath = vi.fn(async () => undefined);
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      vi.fn(async () => undefined),
      openPath,
    );

    await service.openFolder('one');

    expect(openPath).toHaveBeenCalledWith(instance.mofoxInstallDir);
  });

  it('forwards update patches that do not touch paths', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    repository.update.mockResolvedValue({ ...instance, name: 'Renamed' });
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );

    const updated = await service.update('one', { name: 'Renamed' });

    expect(repository.update).toHaveBeenCalledWith('one', { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
  });

  it('validates the MoFox directory and main.py before persisting', async () => {
    const root = await createTemporaryDirectory();
    const instance = createInstance();
    const repository = createRepository(instance);
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );

    await expect(
      service.update('one', { mofoxInstallDir: join(root, 'missing') }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repository.update).not.toHaveBeenCalled();

    const mofoxDirectory = await createMofoxDirectory(root);
    await service.update('one', { mofoxInstallDir: mofoxDirectory });
    expect(repository.update).toHaveBeenCalledWith('one', { mofoxInstallDir: mofoxDirectory });
  });

  it('validates the platform directory against the chosen platform entry', async () => {
    const root = await createTemporaryDirectory();
    const instance = createInstance();
    const repository = createRepository(instance);
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver([createFakePlatform('test', 'Test')]),
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
    );

    const emptyPlatformDirectory = join(root, 'platform');
    await mkdir(emptyPlatformDirectory);
    await expect(
      service.update('one', {
        platform: { id: 'test', installDir: emptyPlatformDirectory, version: null },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(repository.update).not.toHaveBeenCalled();

    const platformDirectory = await createPlatformDirectory(root, 'valid');
    await service.update('one', {
      platform: { id: 'test', installDir: platformDirectory, version: '1' },
    });
    expect(repository.update).toHaveBeenCalledWith('one', {
      platform: { id: 'test', installDir: platformDirectory, version: '1' },
    });
  });
});

function createInstance(): Instance {
  return {
    id: 'one',
    name: 'One',
    mofoxInstallDir: 'D:\\Bot',
    platform: { id: 'test', installDir: 'D:\\Bot', version: '1' },
    status: 'stopped',
    createdAt: 1,
    lastStartedAt: null,
    autoStart: false,
  };
}

function createRepository(instance: Instance) {
  return {
    list: vi.fn(async () => [instance]),
    remove: vi.fn(async () => undefined),
    update: vi.fn(async () => instance),
  };
}
