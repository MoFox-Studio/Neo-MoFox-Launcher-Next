import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstanceRepository } from '../../../src/main/services/instance-repository';
import {
  DEFAULT_INSTANCE,
  normalizeInstance,
} from '../../../src/main/utils/instance-migrations';
import { INSTANCES_VERSION, type Instance } from '../../../src/shared/domain/instance';

/** 验证仓库首次加载、历史格式归一化、坏记录隔离及原子增删后的状态。 */
const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-instances-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('InstanceRepository', () => {
  it('returns an empty list when the repository does not exist', async () => {
    const repository = new InstanceRepository(await createTempDirectory());

    await expect(repository.list()).resolves.toEqual([]);
  });

  it('migrates a legacy versioned repository and resets transient status', async () => {
    const directory = await createTempDirectory();
    await writeFile(
      join(directory, 'instances.json'),
      JSON.stringify({
        version: 4,
        instances: [
          {
            id: 'bot-10001',
            qqNickname: 'Legacy bot',
            neomofoxDir: 'D:\\Bots\\10001',
            platform: 'napcat',
            platformVersion: '4.2.0',
            status: 'running',
            extra: { displayName: 'Primary bot' },
          },
        ],
      }),
    );
    const repository = new InstanceRepository(directory, vi.fn());

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'bot-10001',
        name: 'Primary bot',
        // v1 installPath 升级为当前的 mofoxInstallDir；platformId 收敛为平铺 platform。
        mofoxInstallDir: 'D:\\Bots\\10001',
        platform: { id: 'napcat', installDir: 'D:\\Bots\\napcat', version: '4.2.0' },
        status: 'stopped',
      }),
    ]);
  });

  it('skips malformed entries and reports diagnostics', async () => {
    const directory = await createTempDirectory();
    await writeFile(join(directory, 'instances.json'), JSON.stringify([{ name: 'Missing id' }]));
    const report = vi.fn();
    const repository = new InstanceRepository(directory, report);

    await expect(repository.list()).resolves.toEqual([]);
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining('invalid instance'),
      expect.any(Error),
    );
  });

  it('does not overwrite damaged JSON', async () => {
    const directory = await createTempDirectory();
    const path = join(directory, 'instances.json');
    await writeFile(path, 'not json');
    const repository = new InstanceRepository(directory, vi.fn());

    await expect(repository.list()).resolves.toEqual([]);
    await expect(readFile(path, 'utf8')).resolves.toBe('not json');
  });

  it('creates and updates canonical records atomically, building the structure internally', async () => {
    const directory = await createTempDirectory();
    const repository = new InstanceRepository(directory);
    const created = await repository.create({
      id: 'instance-1',
      name: 'Test',
      mofoxInstallDir: 'D:\\Bots\\Test',
      platform: { id: 'snowluma', installDir: 'D:\\Bots\\Test\\snowluma', version: '1.0.0' },
    });

    // 调用方只提供业务字段，其余字段由仓库内部以默认值补齐。
    expect(created).toEqual({
      ...DEFAULT_INSTANCE,
      id: 'instance-1',
      name: 'Test',
      mofoxInstallDir: 'D:\\Bots\\Test',
      platform: { id: 'snowluma', installDir: 'D:\\Bots\\Test\\snowluma', version: '1.0.0' },
      status: 'stopped',
      createdAt: expect.any(Number),
      autoStart: false,
    });
    expect(await repository.list()).toEqual([created]);

    await repository.update('instance-1', { name: 'Updated' });
    expect(await repository.list()).toEqual([{ ...created, name: 'Updated' }]);
    await repository.remove('instance-1');
    expect(await repository.list()).toEqual([]);
  });

  // ─── 版本升级与合并 ──────────────────────────────────────────────────

  it('eagerly upgrades a legacy versioned file on load and persists the current version', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: 4,
        instances: [
          {
            id: 'bot-1',
            qqNickname: 'Legacy',
            neomofoxDir: 'D:\\Bots\\1',
            platform: 'napcat',
            platformVersion: '4.2.0',
            extra: { displayName: '主号' },
          },
        ],
      }),
    );
    const repository = new InstanceRepository(directory, vi.fn());

    // 首次读取触发升级；磁盘文件应被改写为当前版本且字段已规范化。
    const loaded = await repository.list();
    expect(loaded).toEqual([
      expect.objectContaining({
        id: 'bot-1',
        name: '主号',
        // v1 的 installPath/platformId 拆分为当前的 mofoxInstallDir + 平铺 platform。
        mofoxInstallDir: 'D:\\Bots\\1',
        platform: { id: 'napcat', installDir: 'D:\\Bots\\napcat', version: '4.2.0' },
      }),
    ]);

    const persisted = JSON.parse(await readFile(instancesPath, 'utf8'));
    expect(persisted.version).toBe(INSTANCES_VERSION);
    expect(persisted.instances[0]).toEqual(expect.objectContaining({ id: 'bot-1', name: '主号' }));
    // 旧字段不应在升级后的文件中残留。
    expect(persisted.instances[0].qqNickname).toBeUndefined();
    expect(persisted.instances[0].neomofoxDir).toBeUndefined();
    expect(persisted.instances[0].installPath).toBeUndefined();
    expect(persisted.instances[0].platformId).toBeUndefined();
    expect(persisted.instances[0].version).toBeUndefined();
  });

  it('leaves an already-current file untouched on load', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    const payload = { version: INSTANCES_VERSION, instances: [] };
    await writeFile(instancesPath, JSON.stringify(payload));
    const repository = new InstanceRepository(directory, vi.fn());

    await repository.list();
    expect(JSON.parse(await readFile(instancesPath, 'utf8'))).toEqual(payload);
  });

  it('normalizes a current-version file by completing missing fields and removing extras', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: INSTANCES_VERSION,
        deprecatedRepositoryField: true,
        instances: [
          {
            id: 'bot-1',
            name: 'Bot 1',
            mofoxInstallDir: '/bots/1',
            createdAt: 123,
            deprecatedInstanceField: true,
          },
        ],
      }),
    );
    const repository = new InstanceRepository(directory, vi.fn());

    await expect(repository.list()).resolves.toEqual([
      {
        ...DEFAULT_INSTANCE,
        id: 'bot-1',
        name: 'Bot 1',
        mofoxInstallDir: '/bots/1',
        createdAt: 123,
      },
    ]);
    expect(JSON.parse(await readFile(instancesPath, 'utf8'))).toEqual({
      version: INSTANCES_VERSION,
      instances: [
        {
          ...DEFAULT_INSTANCE,
          id: 'bot-1',
          name: 'Bot 1',
          mofoxInstallDir: '/bots/1',
          createdAt: 123,
        },
      ],
    });
  });

  it('uses the default instance structure for an unhandled repository version', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: INSTANCES_VERSION + 1,
        instances: [{ id: 'bot-1', name: 'Bot 1', mofoxInstallDir: '/bots/1', createdAt: 123 }],
      }),
    );
    const repository = new InstanceRepository(directory, vi.fn());

    await repository.list();

    expect(JSON.parse(await readFile(instancesPath, 'utf8'))).toEqual({
      version: INSTANCES_VERSION,
      instances: [
        {
          ...DEFAULT_INSTANCE,
          id: 'bot-1',
          name: 'Bot 1',
          mofoxInstallDir: '/bots/1',
          createdAt: 123,
        },
      ],
    });
  });

  it('mergeExternal imports non-conflicting instances and skips duplicates', async () => {
    const directory = await createTempDirectory();
    const repository = new InstanceRepository(directory);
    const existing = await repository.create({
      id: 'ins-a',
      name: 'A',
      mofoxInstallDir: 'D:\\Bots\\a',
      platform: { id: 'napcat', installDir: 'D:\\Bots\\a\\napcat', version: '1.0.0' },
    });

    const incoming: Instance[] = [
      // 与已有 ID 冲突
      { ...existing, name: 'A-dup' },
      // 与已有 mofoxInstallDir 冲突
      { ...existing, id: 'ins-a2', mofoxInstallDir: existing.mofoxInstallDir },
      // 字段缺失，应被合并阶段校验跳过
      {
        id: '',
        name: '',
        mofoxInstallDir: '',
        platform: null,
        status: 'stopped' as const,
        createdAt: 2,
        lastStartedAt: null,
        autoStart: false,
      },
      // 全新实例
      {
        id: 'ins-b',
        name: 'B',
        mofoxInstallDir: 'D:\\Bots\\b',
        platform: { id: 'snowluma', installDir: 'D:\\Bots\\b\\snowluma', version: '2.0.0' },
        status: 'stopped' as const,
        createdAt: 3,
        lastStartedAt: null,
        autoStart: true,
      },
    ];

    const result = await repository.mergeExternal(incoming);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].id).toBe('ins-b');
    expect(result.skipped).toHaveLength(3);

    const list = await repository.list();
    expect(list.map((i) => i.id).sort()).toEqual(['ins-a', 'ins-b']);
  });

  it('normalizeInstance maps legacy fields to canonical schema', () => {
    const normalized = normalizeInstance({
      id: 'bot-2',
      qqNickname: '旧昵称',
      neomofoxDir: '/bots/2',
      platform: 'napcat',
      platformVersion: '4.1.0',
      createdAt: '2024-01-02T03:04:05Z',
      status: 'running',
      autoStart: true,
      extra: { displayName: '展示名' },
    });
    expect(normalized).toEqual(
      expect.objectContaining({
        id: 'bot-2',
        name: '展示名',
        // v1 的 installPath/platformId 收敛为当前的 mofoxInstallDir + 平铺 platform。
        mofoxInstallDir: '/bots/2',
        platform: { id: 'napcat', installDir: '/bots/napcat', version: '4.1.0' },
        status: 'stopped',
        autoStart: true,
      }),
    );
  });

  it('drops a legacy MoFox version while keeping the legacy platform version', () => {
    const normalized = normalizeInstance({
      id: 'bot-3',
      name: '平台版本实例',
      neomofoxDir: '/bots/3',
      platform: 'napcat',
      neomofoxVersion: '0.9.5',
      platformVersion: '4.2.19',
    });

    expect(normalized).toMatchObject({
      id: 'bot-3',
      platform: { id: 'napcat', installDir: '/bots/napcat', version: '4.2.19' },
    });
    expect(normalized).not.toHaveProperty('version');
  });

  it('drops the ambiguous v2 version when the record includes a MoFox directory', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: 2,
        instances: [
          {
            id: 'bot-v2',
            name: '旧手动导入实例',
            version: '0.9.5',
            mofoxInstallDir: '/bots/mofox',
            platforms: { napcat: '/bots/napcat' },
            createdAt: 123,
          },
        ],
      }),
    );

    const repository = new InstanceRepository(directory, vi.fn());
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'bot-v2',
        mofoxInstallDir: '/bots/mofox',
        platform: { id: 'napcat', installDir: '/bots/napcat' },
      }),
    ]);

    const persisted = JSON.parse(await readFile(instancesPath, 'utf8'));
    expect(persisted.version).toBe(INSTANCES_VERSION);
    expect(persisted.instances[0].version).toBeUndefined();
    expect(persisted.instances[0].platformVersion).toBeUndefined();
  });

  it('keeps the v2 installer version as the platform version for platform-only records', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: 2,
        instances: [
          {
            id: 'bot-v2-install',
            name: '旧安装实例',
            version: '4.2.19',
            mofoxInstallDir: '',
            platforms: { napcat: '/bots/napcat' },
            createdAt: 123,
          },
        ],
      }),
    );

    const repository = new InstanceRepository(directory, vi.fn());
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'bot-v2-install',
        platform: { id: 'napcat', installDir: '/bots/napcat', version: '4.2.19' },
      }),
    ]);

    const persisted = JSON.parse(await readFile(instancesPath, 'utf8'));
    expect(persisted.instances[0]).toMatchObject({
      platform: { id: 'napcat', installDir: '/bots/napcat', version: '4.2.19' },
    });
    expect(persisted.instances[0].version).toBeUndefined();
  });

  it('moves the v3 platform version into its platform entry on load', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: 3,
        instances: [
          {
            id: 'bot-v3',
            name: '旧平台版本实例',
            platformVersion: '4.2.19',
            mofoxInstallDir: '/bots/mofox',
            platforms: { napcat: '/bots/napcat' },
            createdAt: 123,
          },
        ],
      }),
    );

    const repository = new InstanceRepository(directory, vi.fn());
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'bot-v3',
        platform: { id: 'napcat', installDir: '/bots/napcat', version: '4.2.19' },
      }),
    ]);

    const persisted = JSON.parse(await readFile(instancesPath, 'utf8'));
    expect(persisted.version).toBe(INSTANCES_VERSION);
    expect(persisted.instances[0].platformVersion).toBeUndefined();
    expect(persisted.instances[0].platform).toEqual({
      id: 'napcat',
      installDir: '/bots/napcat',
      version: '4.2.19',
    });
  });

  it('keeps the platform directory separate from the MoFox directory during legacy migration', () => {
    const normalized = normalizeInstance({
      id: 'bot-4',
      name: '独立平台目录',
      neomofoxDir: '/bots/4/mofox',
      platform: 'napcat',
      platformDir: '/bots/4/napcat',
      platformVersion: '4.2.19',
    });

    expect(normalized).toMatchObject({
      mofoxInstallDir: '/bots/4/mofox',
      platform: { id: 'napcat', installDir: '/bots/4/napcat', version: '4.2.19' },
    });
  });

  it('flattens a legacy multi-entry platforms dict to a single platform', () => {
    const normalized = normalizeInstance({
      id: 'bot-5',
      name: 'NapCat 版本实例',
      neomofoxDir: '/bots/5/mofox',
      platform: 'snowluma',
      platforms: {
        napcat: '/bots/5/napcat',
        snowluma: '/bots/5/snowluma',
      },
      napcatVersion: '4.2.19',
    });

    expect(normalized.platform).toEqual({
      id: 'napcat',
      installDir: '/bots/5/napcat',
      version: '4.2.19',
    });
  });
});
