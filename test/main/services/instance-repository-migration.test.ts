import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstanceRepository } from '../../../src/main/services/instance-repository';
import { INSTANCES_VERSION } from '../../../src/shared/domain/instance';
import { upgradeInstancePathsToV2 } from '../../../src/main/utils/instance-migrations';

/**
 * v1 到当前实例仓库结构的迁移端到端测试。
 *
 * v1 的 `installPath` 同时承担 MoFox 本体目录与平台目录两重语义，运行时靠
 * `dirname(installPath)/<platformId>` 兄弟目录回退定位平台。v2 把二者拆开：
 * `mofoxInstallDir` 指向 MoFox 本体，`platforms[platformId]` 显式记录平台安装信息。
 * 迁移时沿用旧的兄弟目录启发式，把平台路径烘焙为显式值，旧实例无需重新配置即可启动。
 */
const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-migration-v1v2-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('upgradeInstancePathsToV2', () => {
  it('splits installPath into mofoxInstallDir and a sibling-derived platform path', () => {
    const result = upgradeInstancePathsToV2({
      installPath: 'D:\\Bots\\mofox',
      platformId: 'napcat',
    });
    expect(result.mofoxInstallDir).toBe('D:\\Bots\\mofox');
    // 兄弟目录启发式：dirname(installPath)/<platformId>
    expect(result.platforms).toEqual({ napcat: { installDir: 'D:\\Bots\\napcat' } });
  });

  it('uses posix separators when the install path uses them', () => {
    const result = upgradeInstancePathsToV2({
      installPath: '/home/u/bots/mofox',
      platformId: 'snowluma',
    });
    expect(result.platforms).toEqual({ snowluma: { installDir: '/home/u/bots/snowluma' } });
  });

  it('preserves an explicit platforms dict and does not overwrite with the sibling heuristic', () => {
    const result = upgradeInstancePathsToV2({
      installPath: '/bots/mofox',
      platformId: 'napcat',
      platforms: { napcat: { installDir: '/explicit/napcat' } },
    });
    expect(result.platforms).toEqual({ napcat: { installDir: '/explicit/napcat' } });
  });

  it('returns an empty platforms dict when platformId is missing', () => {
    const result = upgradeInstancePathsToV2({ installPath: '/bots/mofox' });
    expect(result.mofoxInstallDir).toBe('/bots/mofox');
    expect(result.platforms).toEqual({});
  });

  it('returns empty values when both installPath and mofoxInstallDir are missing', () => {
    const result = upgradeInstancePathsToV2({});
    expect(result.mofoxInstallDir).toBe('');
    expect(result.platforms).toEqual({});
  });
});

describe('InstanceRepository legacy migration', () => {
  it('upgrades a v1 repository file: installPath splits into mofoxInstallDir + platforms sibling path', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    // v1 仓库文件：version=1，实例含 installPath + platformId 单字段。
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: 1,
        instances: [
          {
            id: 'bot-1',
            name: '主号',
            version: '4.2.0',
            platformId: 'napcat',
            installPath: 'D:\\Bots\\mofox-1',
            status: 'stopped',
            createdAt: 123,
            autoStart: true,
          },
        ],
      }),
    );
    const repository = new InstanceRepository(directory, vi.fn());

    const loaded = await repository.list();

    // 当前结构：installPath → mofoxInstallDir；platformId + 兄弟目录 → platforms 字典。
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(
      expect.objectContaining({
        id: 'bot-1',
        mofoxInstallDir: 'D:\\Bots\\mofox-1',
        platforms: { napcat: { installDir: 'D:\\Bots\\napcat' } },
      }),
    );
    // 已废弃的 v1 字段不应出现在内存对象中。
    expect(loaded[0]).not.toHaveProperty('installPath');
    expect(loaded[0]).not.toHaveProperty('platformId');

    // 磁盘文件应被回写为 v2 版本，且 v1 字段已移除。
    const persisted = JSON.parse(await readFile(instancesPath, 'utf8'));
    expect(persisted.version).toBe(INSTANCES_VERSION);
    expect(persisted.instances[0]).toEqual(
      expect.objectContaining({
        id: 'bot-1',
        mofoxInstallDir: 'D:\\Bots\\mofox-1',
        platforms: { napcat: { installDir: 'D:\\Bots\\napcat' } },
      }),
    );
    expect(persisted.instances[0].installPath).toBeUndefined();
    expect(persisted.instances[0].platformId).toBeUndefined();
  });

  it('upgrades multiple v1 instances with different platforms to independent sibling paths', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: 1,
        instances: [
          { id: 'a', name: 'A', platformId: 'napcat', installPath: '/bots/a/mofox', createdAt: 1 },
          { id: 'b', name: 'B', platformId: 'snowluma', installPath: '/bots/b/mofox', createdAt: 2 },
        ],
      }),
    );
    const repository = new InstanceRepository(directory, vi.fn());

    const loaded = await repository.list();
    const byId = Object.fromEntries(loaded.map((i) => [i.id, i]));
    expect(byId.a.platforms).toEqual({ napcat: { installDir: '/bots/a/napcat' } });
    expect(byId.b.platforms).toEqual({ snowluma: { installDir: '/bots/b/snowluma' } });
  });

  it('leaves an already-current file untouched on load', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    const payload = {
      version: INSTANCES_VERSION,
      instances: [
        {
          id: 'bot-1',
          name: 'Bot 1',
          mofoxInstallDir: '/bots/mofox',
          platforms: { napcat: { installDir: '/bots/napcat', version: '1.0.0' } },
          status: 'stopped',
          createdAt: 123,
          lastStartedAt: null,
          autoStart: false,
        },
      ],
    };
    await writeFile(instancesPath, JSON.stringify(payload));
    const repository = new InstanceRepository(directory, vi.fn());

    await repository.list();
    // 已是当前规范结构的文件不应触发回写。
    expect(JSON.parse(await readFile(instancesPath, 'utf8'))).toEqual(payload);
  });

  it('upgraded instances keep working after a reload (idempotent migration)', async () => {
    const directory = await createTempDirectory();
    const instancesPath = join(directory, 'instances.json');
    await writeFile(
      instancesPath,
      JSON.stringify({
        version: 1,
        instances: [
          { id: 'bot-1', name: 'Bot', platformId: 'napcat', installPath: '/bots/mofox', createdAt: 1 },
        ],
      }),
    );

    // 第一次读取触发升级并回写当前结构。
    const repository = new InstanceRepository(directory, vi.fn());
    const first = await repository.list();
    expect(first[0].platforms).toEqual({ napcat: { installDir: '/bots/napcat' } });

    // 第二次读取（新仓库实例）不应再次改动文件，字段保持稳定。
    const reloaded = new InstanceRepository(directory, vi.fn());
    const second = await reloaded.list();
    expect(second).toEqual(first);
    const persisted = JSON.parse(await readFile(instancesPath, 'utf8'));
    expect(persisted.version).toBe(INSTANCES_VERSION);
  });
});
