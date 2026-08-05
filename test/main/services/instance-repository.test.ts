import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INSTANCE,
  InstanceRepository,
  normalizeInstance,
} from '../../../src/main/services/instance-repository';
import { INSTANCES_VERSION } from '../../../src/shared/domain/instance';

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
        version: '4.2.0',
        platformId: 'napcat',
        installPath: 'D:\\Bots\\10001',
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
      version: '1.0.0',
      platformId: 'snowluma',
      installPath: 'D:\\Bots\\Test',
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

  it('eagerly upgrades a legacy versioned file on load and persists version 1', async () => {
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
      expect.objectContaining({ id: 'bot-1', name: '主号', platformId: 'napcat' }),
    ]);

    const persisted = JSON.parse(await readFile(instancesPath, 'utf8'));
    expect(persisted.version).toBe(INSTANCES_VERSION);
    expect(persisted.instances[0]).toEqual(expect.objectContaining({ id: 'bot-1', name: '主号' }));
    // 旧字段不应在升级后的文件中残留。
    expect(persisted.instances[0].qqNickname).toBeUndefined();
    expect(persisted.instances[0].neomofoxDir).toBeUndefined();
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
            installPath: '/bots/1',
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
        installPath: '/bots/1',
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
          installPath: '/bots/1',
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
        instances: [{ id: 'bot-1', name: 'Bot 1', installPath: '/bots/1', createdAt: 123 }],
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
          installPath: '/bots/1',
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
      version: '1.0.0',
      platformId: 'napcat',
      installPath: 'D:\\Bots\\a',
      status: 'stopped' as const,
      createdAt: 1,
      autoStart: false,
    };
    await repository.upsert(existing);

    const incoming = [
      // 与已有 ID 冲突
      { ...existing, name: 'A-dup' },
      // 与已有 installPath 冲突
      { ...existing, id: 'ins-a2', installPath: existing.installPath },
      // 字段缺失，应被合并阶段校验跳过
      {
        id: '',
        name: '',
        version: '1',
        platformId: 'x',
        installPath: '',
        status: 'stopped' as const,
        createdAt: 2,
        autoStart: false,
      },
      // 全新实例
      {
        id: 'ins-b',
        name: 'B',
        version: '2.0.0',
        platformId: 'snowluma',
        installPath: 'D:\\Bots\\b',
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
        platformId: 'napcat',
        installPath: '/bots/2',
        version: '4.1.0',
        status: 'stopped',
        autoStart: true,
      }),
    );
  });
});
