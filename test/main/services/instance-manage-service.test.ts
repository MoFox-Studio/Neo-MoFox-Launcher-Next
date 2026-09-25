import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import type { BotPlatform } from '../../../src/shared/domain/bot-platform';
import { InstanceManageService } from '../../../src/main/services/instance-manage-service';

/** 覆盖删除前停机、目录/记录回收、安装文件夹清扫、缓冲清理、打开安装目录与更新配置及路径核验。 */
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-manage-service-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createRuntime() {
  return {
    withStoppedSources: vi.fn(
      async <T>(_instanceId: string, _sources: readonly string[], operation: () => Promise<T>) =>
        operation(),
    ),
    clearLogs: vi.fn(),
  };
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
  it('restores both directories if removing the repository record fails', async () => {
    const root = await createTemporaryDirectory();
    const instance = createInstance();
    instance.mofoxInstallDir = await createMofoxDirectory(root);
    instance.platform.installDir = await createPlatformDirectory(root, 'platform');
    // 安装文件夹内的多余文件使清扫不生效，回滚覆盖逐根改名路径。
    await writeFile(join(root, 'keep.txt'), 'x');
    const repository = createRepository(instance);
    repository.remove.mockRejectedValueOnce(new Error('disk full'));
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(),
    );
    await expect(service.remove(instance.id, 'files')).rejects.toThrow('disk full');
    await expect(access(join(instance.mofoxInstallDir, 'main.py'))).resolves.toBeUndefined();
    await expect(access(join(instance.platform.installDir, 'index.mjs'))).resolves.toBeUndefined();
    expect(removePath).not.toHaveBeenCalled();
  });

  it('preserves parent directories containing another instance', async () => {
    const root = await createTemporaryDirectory();
    const parent = await createMofoxDirectory(root);
    const child = await createMofoxDirectory(parent, 'child');
    const instance = {
      ...createInstance(),
      mofoxInstallDir: parent,
      platform: { id: null, installDir: null, version: null },
    };
    const repository = createRepository(instance);
    repository.list.mockResolvedValue([
      instance,
      { ...instance, id: 'two', mofoxInstallDir: child },
    ]);
    const removePath = vi.fn();
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(),
    );
    await service.remove(instance.id, 'files');
    await expect(access(join(child, 'main.py'))).resolves.toBeUndefined();
    expect(removePath).not.toHaveBeenCalled();
    expect(repository.remove).toHaveBeenCalledWith(instance.id);
  });
  it('stops, removes the directory and record, then clears logs', async () => {
    const root = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const platformInstallDir = await createPlatformDirectory(root, 'platform');
    // 多余文件阻止安装文件夹清扫，使本体与平台作为两个独立根删除。
    await writeFile(join(root, 'keep.txt'), 'x');
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir: join(mofoxInstallDir, '.venv'),
      platform: { id: 'test', installDir: platformInstallDir, version: '1' },
    };
    const repository = createRepository(instance);
    const runtime = createRuntime();
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      runtime,
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one', 'files');

    expect(runtime.withStoppedSources).toHaveBeenCalledWith(
      'one',
      ['mofox', 'platform'],
      expect.any(Function),
      false,
    );
    expect(removePath).toHaveBeenCalledTimes(2);
    expect(removePath.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.mofox.neo-mofox-delete-'),
        expect.stringContaining('.platform.neo-mofox-delete-'),
      ]),
    );
    expect(repository.remove).toHaveBeenCalledWith('one');
    expect(runtime.clearLogs).toHaveBeenCalledWith('one');
  });

  it('keeps every file on disk when removing in record mode', async () => {
    const root = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir: join(mofoxInstallDir, '.venv'),
      platform: { id: null, installDir: null, version: null },
    };
    const repository = createRepository(instance);
    const runtime = createRuntime();
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      runtime,
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one', 'record');

    expect(repository.remove).toHaveBeenCalledWith('one');
    expect(runtime.clearLogs).toHaveBeenCalledWith('one');
    expect(removePath).not.toHaveBeenCalled();
    await expect(access(join(mofoxInstallDir, 'main.py'))).resolves.toBeUndefined();
  });

  it('sweeps the install folder when it only contains the instance files', async () => {
    const root = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const platformInstallDir = await createPlatformDirectory(root, 'platform');
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir: join(mofoxInstallDir, '.venv'),
      platform: { id: 'test', installDir: platformInstallDir, version: '1' },
    };
    const repository = createRepository(instance);
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one', 'files');

    // 安装文件夹整体改名隔离后删除，仅剩一次物理删除。
    expect(removePath).toHaveBeenCalledTimes(1);
    expect(removePath.mock.calls.map(([path]) => path)).toEqual([
      expect.stringContaining(`.${basename(root)}.neo-mofox-delete-`),
    ]);
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(repository.remove).toHaveBeenCalledWith('one');
  });

  it('ignores system junk files when sweeping the install folder', async () => {
    const root = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const platformInstallDir = await createPlatformDirectory(root, 'platform');
    await writeFile(join(root, '.DS_Store'), 'junk');
    await writeFile(join(root, 'Thumbs.db'), 'junk');
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir: join(mofoxInstallDir, '.venv'),
      platform: { id: 'test', installDir: platformInstallDir, version: '1' },
    };
    const repository = createRepository(instance);
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one', 'files');

    expect(removePath).toHaveBeenCalledTimes(1);
    expect(removePath.mock.calls.map(([path]) => path)).toEqual([
      expect.stringContaining(`.${basename(root)}.neo-mofox-delete-`),
    ]);
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the install folder when it contains unrelated files', async () => {
    const root = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const platformInstallDir = await createPlatformDirectory(root, 'platform');
    await writeFile(join(root, 'notes.txt'), '用户数据');
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir: join(mofoxInstallDir, '.venv'),
      platform: { id: 'test', installDir: platformInstallDir, version: '1' },
    };
    const repository = createRepository(instance);
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one', 'files');

    expect(removePath).toHaveBeenCalledTimes(2);
    expect(removePath.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.mofox.neo-mofox-delete-'),
        expect.stringContaining('.platform.neo-mofox-delete-'),
      ]),
    );
    // 安装文件夹与无关文件保留，仅实例目录被删。
    await expect(access(join(root, 'notes.txt'))).resolves.toBeUndefined();
    await expect(access(mofoxInstallDir)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(platformInstallDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('deletes an external venv as its own root and still sweeps the install folder', async () => {
    const root = await createTemporaryDirectory();
    const venvRoot = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const platformInstallDir = await createPlatformDirectory(root, 'platform');
    const venvDir = join(venvRoot, 'venv');
    await mkdir(venvDir, { recursive: true });
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir,
      platform: { id: 'test', installDir: platformInstallDir, version: '1' },
    };
    const repository = createRepository(instance);
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one', 'files');

    // 安装文件夹与外部 venv 各自独立改名删除，互不影响。
    expect(removePath).toHaveBeenCalledTimes(2);
    expect(removePath.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`.${basename(root)}.neo-mofox-delete-`),
        expect.stringContaining('.venv.neo-mofox-delete-'),
      ]),
    );
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(venvDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('folds a sibling venv inside the install folder into the sweep', async () => {
    const root = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const platformInstallDir = await createPlatformDirectory(root, 'platform');
    const venvDir = join(root, '.venv');
    await mkdir(venvDir, { recursive: true });
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir,
      platform: { id: 'test', installDir: platformInstallDir, version: '1' },
    };
    const repository = createRepository(instance);
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one', 'files');

    expect(removePath).toHaveBeenCalledTimes(1);
    expect(removePath.mock.calls.map(([path]) => path)).toEqual([
      expect.stringContaining(`.${basename(root)}.neo-mofox-delete-`),
    ]);
    await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not sweep the install folder when another instance lives inside it', async () => {
    const root = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const platformInstallDir = await createPlatformDirectory(root, 'platform');
    const otherMofox = await createMofoxDirectory(root, 'other-mofox');
    const otherPlatform = await createPlatformDirectory(root, 'other-platform');
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir: join(mofoxInstallDir, '.venv'),
      platform: { id: 'test', installDir: platformInstallDir, version: '1' },
    };
    const other = {
      ...instance,
      id: 'two',
      name: 'Two',
      mofoxInstallDir: otherMofox,
      venvDir: join(otherMofox, '.venv'),
      platform: { id: 'test', installDir: otherPlatform, version: '1' },
    };
    const repository = createRepository(instance);
    repository.list.mockResolvedValue([instance, other]);
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await service.remove('one', 'files');

    expect(removePath).toHaveBeenCalledTimes(2);
    expect(removePath.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.mofox.neo-mofox-delete-'),
        expect.stringContaining('.platform.neo-mofox-delete-'),
      ]),
    );
    await expect(access(join(root, 'other-mofox', 'main.py'))).resolves.toBeUndefined();
    await expect(access(mofoxInstallDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores a swept install folder if removing the repository record fails', async () => {
    const root = await createTemporaryDirectory();
    const mofoxInstallDir = await createMofoxDirectory(root);
    const platformInstallDir = await createPlatformDirectory(root, 'platform');
    const instance = {
      ...createInstance(),
      mofoxInstallDir,
      venvDir: join(mofoxInstallDir, '.venv'),
      platform: { id: 'test', installDir: platformInstallDir, version: '1' },
    };
    const repository = createRepository(instance);
    repository.remove.mockRejectedValueOnce(new Error('disk full'));
    const removePath = vi.fn(async (path: string) => rm(path, { recursive: true, force: true }));
    const service = new InstanceManageService(
      createRuntime(),
      repository,
      createPlatformResolver(),
      removePath,
      vi.fn(async () => undefined),
    );

    await expect(service.remove('one', 'files')).rejects.toThrow('disk full');

    // 清扫命中的安装文件夹被整体改名隔离，回滚时原样恢复。
    expect(removePath).not.toHaveBeenCalled();
    await expect(access(join(mofoxInstallDir, 'main.py'))).resolves.toBeUndefined();
    await expect(access(join(platformInstallDir, 'index.mjs'))).resolves.toBeUndefined();
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
    venvDir: 'D:\\Bot/.venv',
    platform: { id: 'test', installDir: 'D:\\Bot', version: '1' },
    status: 'stopped',
    createdAt: 1,
    lastStartedAt: null,
    autoStart: false,
    extra: { isLike: false },
  };
}

function createRepository(instance: Instance) {
  return {
    list: vi.fn(async () => [instance]),
    remove: vi.fn(async () => undefined),
    update: vi.fn(async () => instance),
  };
}
