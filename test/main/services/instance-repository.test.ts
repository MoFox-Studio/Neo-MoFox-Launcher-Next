import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INSTANCE,
  InstanceRepository,
  normalizeInstance,
} from '../../../src/main/services/instance-repository';
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
        platformVersion: '4.2.0',
        // v1 installPath 升级为 v2 的 mofoxInstallDir；platformId 收敛为 platforms 字典。
        mofoxInstallDir: 'D:\\Bots\\10001',
        platforms: { napcat: 'D:\\Bots\\napcat' },
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

  it('upserts and removes canonical records atomically', async () => {
    const directory = await createTempDirectory();
    const repository = new InstanceRepository(directory);
    const instance = {
      id: 'instance-1',
      name: 'Test',
      platformVersion: '1.0.0',
      mofoxInstallDir: 'D:\\Bots\\Test',
      platforms: { snowluma: 'D:\\Bots\\Test\\snowluma' },
      status: 'stopped' as const,
      createdAt: 123,
      autoStart: false,
    };

    await repository.upsert(instance);
    await repository.upsert({ ...instance, name: 'Updated' });
    expect(await repository.list()).toEqual([{ ...instance, name: 'Updated' }]);
    await repository.remove(instance.id);
    expect(await repository.list()).toEqual([]);
  });

  // ─── 版本升级与合并 ──────────────────────────────────────────────────

  it('eagerly upgrades a legacy versioned file on load and persists version 2', async () => {
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
        // v1 的 installPath/platformId 拆分为 v2 的 mofoxInstallDir + platforms 字典。
        mofoxInstallDir: 'D:\\Bots\\1',
        platforms: { napcat: 'D:\\Bots\\napcat' },
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
    const existing = {
      id: 'ins-a',
      name: 'A',
      platformVersion: '1.0.0',
      mofoxInstallDir: 'D:\\Bots\\a',
      platforms: { napcat: 'D:\\Bots\\a\\napcat' },
      status: 'stopped' as const,
      createdAt: 1,
      autoStart: false,
    };
    await repository.upsert(existing);

    const incoming: Instance[] = [
      // 与已有 ID 冲突
      { ...existing, name: 'A-dup' },
      // 与已有 mofoxInstallDir 冲突
      { ...existing, id: 'ins-a2', mofoxInstallDir: existing.mofoxInstallDir },
      // 字段缺失，应被合并阶段校验跳过
      {
        id: '',
        name: '',
        platformVersion: '1',
        mofoxInstallDir: '',
        platforms: {},
        status: 'stopped' as const,
        createdAt: 2,
        autoStart: false,
      },
      // 全新实例
      {
        id: 'ins-b',
        name: 'B',
        platformVersion: '2.0.0',
        mofoxInstallDir: 'D:\\Bots\\b',
        platforms: { snowluma: 'D:\\Bots\\b\\snowluma' },
        status: 'stopped' as const,
        createdAt: 3,
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
        // v1 的 installPath/platformId 收敛为 v2 的 mofoxInstallDir + platforms 字典。
        mofoxInstallDir: '/bots/2',
        platforms: { napcat: '/bots/napcat' },
        platformVersion: '4.1.0',
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
      platformVersion: '4.2.19',
      platforms: { napcat: '/bots/napcat' },
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
        platforms: { napcat: '/bots/napcat' },
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
      expect.objectContaining({ id: 'bot-v2-install', platformVersion: '4.2.19' }),
    ]);

    const persisted = JSON.parse(await readFile(instancesPath, 'utf8'));
    expect(persisted.instances[0]).toMatchObject({ platformVersion: '4.2.19' });
    expect(persisted.instances[0].version).toBeUndefined();
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
      platforms: { napcat: '/bots/4/napcat' },
      platformVersion: '4.2.19',
    });
  });
});
