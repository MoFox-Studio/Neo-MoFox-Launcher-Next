import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LegacyMigrationService,
  resolveLegacyLauncherDataDir,
  resolveNextLauncherDataDir,
} from '../../../src/main/services/legacy-migration-service';
import { InstanceRepository } from '../../../src/main/services/instance-repository';
import type { Instance } from '../../../src/shared/domain/instance';

/** 验证旧启动器探测、预览规范化与冲突判定、导入合并的端到端行为。 */
const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-migration-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function makeInstance(overrides: Partial<Instance>): Instance {
  return {
    id: 'ins-x',
    name: 'X',
    version: '1.0.0',
    mofoxInstallDir: 'D:\\Bots\\x',
    platforms: { napcat: 'D:\\Bots\\napcat' },
    status: 'stopped',
    createdAt: 1,
    autoStart: false,
    ...overrides,
  };
}

describe('launcher data directory isolation', () => {
  it('keeps next launcher data separate from the legacy directory', () => {
    const appDataDir = 'C:\\Users\\tester\\AppData\\Roaming';
    const legacy = resolveLegacyLauncherDataDir({ appDataDir });
    const next = resolveNextLauncherDataDir(appDataDir);

    expect(legacy).toBe('C:\\Users\\tester\\AppData\\Roaming\\Neo-MoFox-Launcher');
    expect(next).toBe('C:\\Users\\tester\\AppData\\Roaming\\Neo-MoFox-Launcher-Next');
    expect(next).not.toBe(legacy);
  });
});

describe('resolveLegacyLauncherDataDir', () => {
  it('joins appDataDir with the legacy app name by default', () => {
    expect(resolveLegacyLauncherDataDir({ appDataDir: '/home/u/.config' })).toBe(
      '/home/u/.config/Neo-MoFox-Launcher',
    );
  });

  it('prefers the override when provided and non-empty', () => {
    expect(
      resolveLegacyLauncherDataDir({ appDataDir: '/home/u/.config', override: '/custom/path' }),
    ).toBe('/custom/path');
  });

  it('ignores whitespace-only override and falls back to default', () => {
    expect(resolveLegacyLauncherDataDir({ appDataDir: '/home/u/.config', override: '   ' })).toBe(
      '/home/u/.config/Neo-MoFox-Launcher',
    );
  });
});

describe('LegacyMigrationService', () => {
  async function writeLegacyInstances(legacyDir: string, payload: unknown): Promise<void> {
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, 'instances.json'), JSON.stringify(payload));
  }

  it('detect returns null when legacy instances.json is missing', async () => {
    const legacyDir = await createTempDirectory();
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    await expect(service.detect()).resolves.toBeNull();
  });

  it('detect reports instance count and modification time', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        { id: 'a', qqNickname: 'A', neomofoxDir: '/a', platform: 'napcat' },
        { id: 'b', qqNickname: 'B', neomofoxDir: '/b', platform: 'snowluma' },
      ],
    });
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    const info = await service.detect();
    expect(info).not.toBeNull();
    expect(info?.instanceCount).toBe(2);
    expect(info?.modifiedAt).toBeTypeOf('number');
  });

  it('detect tolerates a bare-array legacy file', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, [{ id: 'a', neomofoxDir: '/a', platform: 'napcat' }]);
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    const info = await service.detect();
    expect(info?.instanceCount).toBe(1);
  });

  it('preview normalizes legacy records and reports nameSource', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        {
          id: 'bot-1',
          qqNickname: 'QQ 昵称',
          extra: { displayName: '展示名' },
          neomofoxDir: '/bots/1',
          platform: 'napcat',
          platformVersion: '4.2.0',
        },
        {
          id: 'bot-2',
          name: '直接命名',
          neomofoxDir: '/bots/2',
          platform: 'snowluma',
          platformVersion: '1.3.0',
        },
      ],
    });
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    const preview = await service.preview();
    expect(preview.previews).toHaveLength(2);
    // 命名优先级：name > extra.displayName > qqNickname > id
    const sources = preview.previews.map((p) => p.nameSource);
    expect(sources).toContain('extra.displayName');
    expect(sources).toContain('name');
    expect(preview.previews.every((p) => p.conflict === null)).toBe(true);
  });

  it('preview preserves the legacy SnowLuma runtime root instead of guessing a sibling path', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        {
          id: 'snow-1',
          name: 'SnowLuma 实例',
          neomofoxDir: 'D:\\MOFOX22\\bot-3548642985',
          platform: 'snowluma',
          platformDir: 'E:\\Adapters\\SnowLuma-package',
          platformRoot: 'E:\\Adapters\\SnowLuma-package\\SnowLuma',
        },
      ],
    });
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    const preview = await service.preview();
    expect(preview.previews[0].instance.mofoxInstallDir).toBe('D:\\MOFOX22\\bot-3548642985');
    expect(preview.previews[0].instance.platforms).toEqual({
      snowluma: 'E:\\Adapters\\SnowLuma-package\\SnowLuma',
    });
  });

  it('preview flags duplicate-id and duplicate-path conflicts against existing repo', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        { id: 'dup-id', neomofoxDir: '/unique/1', platform: 'napcat' },
        { id: 'fresh', neomofoxDir: '/existing/path', platform: 'napcat' },
        { id: 'clean', neomofoxDir: '/clean/3', platform: 'snowluma' },
      ],
    });
    const repoDir = await createTempDirectory();
    const repository = new InstanceRepository(repoDir);
    await repository.upsert(makeInstance({ id: 'dup-id', mofoxInstallDir: '/elsewhere' }));
    await repository.upsert(makeInstance({ id: 'other', mofoxInstallDir: '/existing/path' }));

    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());
    const preview = await service.preview();
    const conflicts = Object.fromEntries(
      preview.previews.map((p) => [p.instance.id, p.conflict]),
    );
    expect(conflicts['dup-id']).toBe('duplicate-id');
    expect(conflicts['fresh']).toBe('duplicate-path');
    expect(conflicts['clean']).toBeNull();
  });

  it('preview throws NOT_FOUND when legacy data is missing', async () => {
    const legacyDir = await createTempDirectory();
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    await expect(service.preview()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('preview skips malformed legacy records without aborting the rest', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        { neomofoxDir: '/no-id', platform: 'napcat' }, // 缺 id
        { id: 'ok', neomofoxDir: '/ok', platform: 'napcat' },
      ],
    });
    const report = vi.fn();
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(legacyDir, repository, report);

    const preview = await service.preview();
    expect(preview.previews).toHaveLength(1);
    expect(preview.previews[0].instance.id).toBe('ok');
    expect(report).toHaveBeenCalledWith(expect.stringContaining('invalid'), expect.any(Error));
  });

  it('importInstances writes non-conflicting records into the new repo', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        { id: 'new-1', qqNickname: 'A', neomofoxDir: '/a', platform: 'napcat', platformVersion: '4.0' },
        { id: 'new-2', name: 'B', neomofoxDir: '/b', platform: 'snowluma', platformVersion: '1.0' },
      ],
    });
    const repoDir = await createTempDirectory();
    const repository = new InstanceRepository(repoDir);
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    const result = await service.importInstances();
    expect(result).toEqual({ imported: 2, skipped: 0, total: 2 });
    const list = await repository.list();
    expect(list.map((i) => i.id).sort()).toEqual(['new-1', 'new-2']);
  });

  it('repairExistingInstances silently does nothing when legacy data is missing', async () => {
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(await createTempDirectory(), repository, vi.fn());

    await expect(service.repairExistingInstances()).resolves.toBe(0);
  });

  it('repairExistingInstances repairs equivalent Windows MoFox paths without importing new records', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        {
          id: 'existing',
          neomofoxDir: 'd:/MOFOX22/bot-3548642985/',
          platform: 'snowluma',
          platformRoot: 'E:\\SnowLuma\\runtime',
        },
        {
          id: 'legacy-only',
          neomofoxDir: 'D:\\MOFOX22\\legacy-only',
          platform: 'snowluma',
          platformRoot: 'E:\\SnowLuma\\legacy-only',
        },
      ],
    });
    const repository = new InstanceRepository(await createTempDirectory());
    await repository.upsert(
      makeInstance({
        id: 'existing',
        mofoxInstallDir: 'D:\\mofox22\\bot-3548642985',
        platforms: { snowluma: 'D:\\MOFOX22\\snowluma' },
      }),
    );
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    await expect(service.repairExistingInstances()).resolves.toBe(1);
    const list = await repository.list();
    expect(list).toHaveLength(1);
    expect(list[0].platforms).toEqual({ snowluma: 'E:\\SnowLuma\\runtime' });
  });

  it('importInstances repairs an already imported instance with the legacy platform root', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        {
          id: 'snow-existing',
          name: '旧名称',
          neomofoxDir: 'D:\\MOFOX22\\bot-3548642985',
          platform: 'snowluma',
          platformDir: 'E:\\SnowLuma-package',
          platformRoot: 'E:\\SnowLuma-package\\SnowLuma',
        },
      ],
    });
    const repository = new InstanceRepository(await createTempDirectory());
    await repository.upsert(
      makeInstance({
        id: 'snow-existing',
        name: '新版名称',
        mofoxInstallDir: 'D:\\MOFOX22\\bot-3548642985',
        platforms: { snowluma: 'D:\\MOFOX22\\snowluma' },
        autoStart: true,
      }),
    );
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    await expect(service.importInstances()).resolves.toEqual({ imported: 1, skipped: 0, total: 1 });
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'snow-existing',
        name: '新版名称',
        autoStart: true,
        platforms: { snowluma: 'E:\\SnowLuma-package\\SnowLuma' },
      }),
    ]);
  });

  it('importInstances does not repair a duplicate ID that points to another MoFox directory', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        {
          id: 'same-id',
          neomofoxDir: 'D:\\Old\\MoFox',
          platform: 'snowluma',
          platformRoot: 'E:\\Old\\SnowLuma',
        },
      ],
    });
    const repository = new InstanceRepository(await createTempDirectory());
    await repository.upsert(
      makeInstance({
        id: 'same-id',
        mofoxInstallDir: 'D:\\Current\\MoFox',
        platforms: { snowluma: 'E:\\Current\\SnowLuma' },
      }),
    );
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    await expect(service.importInstances()).resolves.toEqual({ imported: 0, skipped: 1, total: 1 });
    const [instance] = await repository.list();
    expect(instance.platforms).toEqual({ snowluma: 'E:\\Current\\SnowLuma' });
  });

  it('importInstances skips conflicting records and reports the count', async () => {
    const legacyDir = await createTempDirectory();
    await writeLegacyInstances(legacyDir, {
      version: 4,
      instances: [
        { id: 'dup', neomofoxDir: '/dup', platform: 'napcat' },
        { id: 'fresh', neomofoxDir: '/fresh', platform: 'snowluma' },
      ],
    });
    const repoDir = await createTempDirectory();
    const repository = new InstanceRepository(repoDir);
    await repository.upsert(makeInstance({ id: 'dup', mofoxInstallDir: '/dup' }));

    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());
    const result = await service.importInstances();
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.total).toBe(2);
  });

  it('importInstances does not modify the legacy file', async () => {
    const legacyDir = await createTempDirectory();
    const legacyPath = join(legacyDir, 'instances.json');
    const original = {
      version: 4,
      instances: [{ id: 'x', neomofoxDir: '/x', platform: 'napcat' }],
    };
    await writeLegacyInstances(legacyDir, original);
    const repository = new InstanceRepository(await createTempDirectory());
    const service = new LegacyMigrationService(legacyDir, repository, vi.fn());

    await service.importInstances();
    expect(JSON.parse(await readFile(legacyPath, 'utf8'))).toEqual(original);
  });
});
