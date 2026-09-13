import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import type { BotPlatform } from '../../../src/shared/domain/bot-platform';
import { InstanceIntegrityService } from '../../../src/main/services/instance-integrity-service';

/** 覆盖主程序目录缺失、平台入口不可解析及正常实例不误报的启动完整性校验。 */
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-integrity-'));
  temporaryDirectories.push(directory);
  return directory;
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
    repository: 'example/test',
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

function createService(
  instances: Instance[],
  platforms: BotPlatform[] = [],
): InstanceIntegrityService {
  return new InstanceIntegrityService(
    { list: async () => instances.map((instance) => ({ ...instance })) },
    createPlatformResolver(platforms),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('InstanceIntegrityService', () => {
  it('returns no issues when every instance is complete', async () => {
    const root = await createTemporaryDirectory();
    const mofox = await createMofoxDirectory(root);
    const platform = await createPlatformDirectory(root, 'platform');
    const instance: Instance = createInstance({
      mofoxInstallDir: mofox,
      platform: { id: 'test', installDir: platform, version: '1' },
    });

    await expect(
      createService([instance], [createFakePlatform('test', 'Test')]).check(),
    ).resolves.toEqual([]);
  });

  it('flags a missing main.py in the MoFox directory', async () => {
    const root = await createTemporaryDirectory();
    const mofox = await createMofoxDirectory(root);
    const instance: Instance = createInstance({ mofoxInstallDir: mofox });
    await rm(join(mofox, 'main.py'));

    await expect(createService([instance]).check()).resolves.toEqual([
      { instanceId: 'one', name: 'One', problems: ['mofox'] },
    ]);
  });

  it('flags a missing MoFox directory', async () => {
    const root = await createTemporaryDirectory();
    const instance: Instance = createInstance({ mofoxInstallDir: join(root, 'missing') });

    await expect(createService([instance]).check()).resolves.toEqual([
      { instanceId: 'one', name: 'One', problems: ['mofox'] },
    ]);
  });

  it('flags a configured platform whose entry cannot be resolved', async () => {
    const root = await createTemporaryDirectory();
    const mofox = await createMofoxDirectory(root);
    const emptyPlatform = join(root, 'empty-platform');
    await mkdir(emptyPlatform);
    const instance: Instance = createInstance({
      mofoxInstallDir: mofox,
      platform: { id: 'test', installDir: emptyPlatform, version: '1' },
    });

    await expect(
      createService([instance], [createFakePlatform('test', 'Test')]).check(),
    ).resolves.toEqual([{ instanceId: 'one', name: 'One', problems: ['platform'] }]);
  });

  it('does not flag an instance without a configured platform', async () => {
    const root = await createTemporaryDirectory();
    const mofox = await createMofoxDirectory(root);
    const instance: Instance = createInstance({ mofoxInstallDir: mofox });

    await expect(createService([instance]).check()).resolves.toEqual([]);
  });

  it('does not flag an instance without a MoFox directory configured', async () => {
    // 安装向导只装平台适配器时主程序目录可留空，由后续流程回填。
    const root = await createTemporaryDirectory();
    const platform = await createPlatformDirectory(root, 'platform');
    const instance: Instance = createInstance({
      mofoxInstallDir: '',
      platform: { id: 'test', installDir: platform, version: '1' },
    });

    await expect(
      createService([instance], [createFakePlatform('test', 'Test')]).check(),
    ).resolves.toEqual([]);
  });

  it('collects issues across multiple instances', async () => {
    const root = await createTemporaryDirectory();
    const complete = createInstance({
      id: 'complete',
      name: 'Complete',
      mofoxInstallDir: await createMofoxDirectory(root, 'complete-mofox'),
    });
    const broken = createInstance({
      id: 'broken',
      name: 'Broken',
      mofoxInstallDir: join(root, 'broken-missing'),
    });

    await expect(createService([complete, broken]).check()).resolves.toEqual([
      { instanceId: 'broken', name: 'Broken', problems: ['mofox'] },
    ]);
  });
});

function createInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: 'one',
    name: 'One',
    mofoxInstallDir: 'D:\\Bot',
    venvDir: 'D:\\Bot/.venv',
    platform: { id: null, installDir: null, version: null },
    status: 'stopped',
    createdAt: 1,
    lastStartedAt: null,
    autoStart: false,
    extra: { isLike: false },
    ...overrides,
  };
}
