import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Instance } from '../../../src/shared/domain/instance';
import type { InstallContext, InstallResult } from '../../../src/shared/domain/bot-platform';

const gitHelpers = vi.hoisted(() => ({
  isGitRepository: vi.fn(),
  getCurrentBranch: vi.fn(),
  getCurrentCommit: vi.fn(),
  getCommitList: vi.fn(),
  checkUpdateStatus: vi.fn(),
  switchBranch: vi.fn(),
  checkoutCommit: vi.fn(),
  updateToLatest: vi.fn(),
  fetchRemoteBranches: vi.fn(),
}));

const githubHelpers = vi.hoisted(() => ({
  fetchReleases: vi.fn(),
}));

vi.mock('../../../src/main/utils/git/git', () => gitHelpers);
vi.mock('../../../src/main/utils/git/github', () => githubHelpers);

import { InstanceUpdateService } from '../../../src/main/services/instance-update-service';
import type { UpdateProgressEvent } from '../../../src/shared/domain/update';

function makeInstance(root: string): Instance {
  return {
    id: 'ins-1',
    name: 'Test',
    mofoxInstallDir: join(root, 'mofox'),
    venvDir: join(root, 'mofox', '.venv'),
    platform: { id: 'snowluma', installDir: join(root, 'platform'), version: 'v1.0.0' },
    status: 'stopped',
    createdAt: 1,
    lastStartedAt: null,
    autoStart: false,
    extra: { isLike: false },
  };
}

function createService(
  root: string,
  platformImpl?: Partial<{ update: (ctx: InstallContext) => Promise<InstallResult> }>,
) {
  const instance = makeInstance(root);
  const repository = {
    list: vi.fn(async () => [instance]),
    update: vi.fn(async () => instance),
  };
  const registry = {
    get: vi.fn(() => ({
      repository: 'SnowLuma/SnowLuma',
      update:
        platformImpl?.update ??
        (async (ctx: InstallContext): Promise<InstallResult> => {
          const payload = join(ctx.workDir, 'payload');
          await mkdir(payload, { recursive: true });
          await writeFile(join(payload, 'index.mjs'), 'new-version');
          return { version: 'v2.0.0', installPath: payload };
        }),
    })),
  };
  const mirrors = { list: vi.fn(() => []) };
  const runtime = {
    withStoppedSources: vi.fn(
      async <T>(_instanceId: string, _sources: readonly string[], operation: () => Promise<T>) =>
        operation(),
    ),
  };
  const events = { progress: vi.fn() };
  const service = new InstanceUpdateService(
    repository,
    registry as unknown as { get(platformId: string): never },
    mirrors,
    runtime,
    events,
  );
  return { service, repository, registry, mirrors, runtime, events, instance };
}

describe('InstanceUpdateService', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mofox-update-'));
    await mkdir(join(root, 'mofox'), { recursive: true });
    await mkdir(join(root, 'platform', 'config'), { recursive: true });
    await writeFile(join(root, 'platform', 'config', 'onebot.json'), '{"enable":true}');
    githubHelpers.fetchReleases.mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('getMofoxInfo aggregates git state into update info', async () => {
    gitHelpers.isGitRepository.mockResolvedValue(true);
    gitHelpers.getCurrentBranch.mockResolvedValue('main');
    gitHelpers.getCurrentCommit.mockResolvedValue({
      hash: 'a1b2c3d',
      message: 'fix',
      date: '2026-08-01T00:00:00Z',
    });
    gitHelpers.getCommitList.mockResolvedValue([]);
    gitHelpers.checkUpdateStatus.mockResolvedValue({
      hasUpdate: true,
      behindCount: 3,
      aheadCount: 0,
    });
    gitHelpers.fetchRemoteBranches.mockResolvedValue(['dev']);

    const { service } = createService(root);
    const info = await service.getMofoxInfo('ins-1');
    expect(info.branch).toBe('main');
    expect(info.hasUpdate).toBe(true);
    expect(info.behindCount).toBe(3);
    // 当前分支补充进远程分支列表。
    expect(info.branches).toEqual(['main', 'dev']);
  });

  it('getMofoxInfo reports a non-repository directory without throwing', async () => {
    gitHelpers.isGitRepository.mockResolvedValue(false);
    const { service } = createService(root);
    const info = await service.getMofoxInfo('ins-1');
    expect(info).toEqual({
      isRepository: false,
      branch: null,
      currentCommit: null,
      branches: [],
      commits: [],
      hasUpdate: false,
      behindCount: 0,
      aheadCount: 0,
    });
  });

  it('switchBranch delegates to git and returns refreshed info', async () => {
    gitHelpers.switchBranch.mockResolvedValue(undefined);
    gitHelpers.isGitRepository.mockResolvedValue(true);
    gitHelpers.getCurrentBranch.mockResolvedValue('dev');
    gitHelpers.getCurrentCommit.mockResolvedValue(null);
    gitHelpers.getCommitList.mockResolvedValue([]);
    gitHelpers.checkUpdateStatus.mockResolvedValue({
      hasUpdate: false,
      behindCount: 0,
      aheadCount: 0,
    });
    gitHelpers.fetchRemoteBranches.mockResolvedValue([]);

    const { service } = createService(root);
    const info = await service.switchBranch('ins-1', 'dev');
    expect(gitHelpers.switchBranch).toHaveBeenCalledWith(
      join(root, 'mofox'),
      'dev',
      expect.any(Function),
    );
    expect(info.branch).toBe('dev');
  });

  it('updatePlatform swaps the existing install through the cache and preserves config', async () => {
    const { service, repository, runtime } = createService(root);
    await service.updatePlatform('ins-1', 'v2.0.0');

    // 新版本应位于安装目录，且用户配置目录被保留。
    const entries = await readdir(join(root, 'platform'));
    expect(entries).toEqual(expect.arrayContaining(['index.mjs', 'config']));
    const preserved = await readFile(join(root, 'platform', 'config', 'onebot.json'), 'utf8');
    expect(preserved).toBe('{"enable":true}');
    // 平台进程在替换前停止。
    expect(runtime.withStoppedSources).toHaveBeenCalledWith(
      'ins-1',
      ['platform'],
      expect.any(Function),
    );
    // 版本号写回持久化层。
    expect(repository.update).toHaveBeenCalledWith('ins-1', {
      platform: expect.objectContaining({ version: 'v2.0.0' }),
    });
    // 缓存目录在收尾时被清理。
    await expect(readdir(join(root, '.update-cache'))).rejects.toThrow('ENOENT');
  });

  it('updatePlatform restores the original version when the update fails', async () => {
    const { service, events } = createService(root, {
      update: async () => {
        throw new Error('download failed');
      },
    });
    await expect(service.updatePlatform('ins-1', 'v2.0.0')).rejects.toThrow('download failed');
    // 失败后原版本还原回安装目录。
    const entries = await readdir(join(root, 'platform'));
    expect(entries).toContain('config');
    expect(events.progress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'update-platform',
        error: 'download failed',
      }) as UpdateProgressEvent,
    );
  });

  it('updatePlatform throws when the instance has no platform', async () => {
    const { service, repository } = createService(root);
    repository.list.mockResolvedValue([
      { ...makeInstance(root), platform: { id: null, installDir: null, version: null } },
    ]);
    await expect(service.updatePlatform('ins-1', 'v2.0.0')).rejects.toThrow('实例未安装平台');
  });

  it('updatePlatform installs fresh when the platform directory is missing', async () => {
    await rm(join(root, 'platform'), { recursive: true, force: true });
    const { service, repository } = createService(root);
    await service.updatePlatform('ins-1', 'v2.0.0');

    // 目录缺失不应导致 ENOENT 失败，而是按首次安装处理。
    const entries = await readdir(join(root, 'platform'));
    expect(entries).toContain('index.mjs');
    expect(repository.update).toHaveBeenCalledWith('ins-1', {
      platform: expect.objectContaining({ version: 'v2.0.0' }) as unknown,
    });
    // 缓存目录在收尾时被清理，无残留。
    const leftovers = (await readdir(root)).filter((name) => name.startsWith('.update-cache-'));
    expect(leftovers).toEqual([]);
  });

  it('updatePlatform recovers an orphaned backup left by an interrupted update', async () => {
    // 模拟上次更新被强制退出：安装目录缺失，原版本遗留在缓存目录中。
    await rm(join(root, 'platform'), { recursive: true, force: true });
    const stale = join(root, '.update-cache-stale', 'existing', 'config');
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, 'onebot.json'), '{"recovered":true}');

    const { service } = createService(root);
    await service.updatePlatform('ins-1', 'v2.0.0');

    // 遗留备份被恢复并作为旧版本参与更新，用户配置得以保留。
    const preserved = await readFile(join(root, 'platform', 'config', 'onebot.json'), 'utf8');
    expect(preserved).toBe('{"recovered":true}');
    const entries = await readdir(join(root, 'platform'));
    expect(entries).toContain('index.mjs');
    // 恢复使用的缓存目录被清理，无残留。
    const leftovers = (await readdir(root)).filter((name) => name.startsWith('.update-cache-'));
    expect(leftovers).toEqual([]);
  });

  it('updatePlatform skips recovery when another instance shares the cache directory', async () => {
    // 另一实例的平台目录位于同一父目录时，遗留缓存归属不明，不应擅自恢复。
    await rm(join(root, 'platform'), { recursive: true, force: true });
    const stale = join(root, '.update-cache-stale', 'existing', 'config');
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, 'onebot.json'), '{"foreign":true}');

    const { service, repository } = createService(root);
    repository.list.mockResolvedValue([
      { ...makeInstance(root), id: 'ins-1' },
      {
        ...makeInstance(root),
        id: 'ins-2',
        platform: { id: 'snowluma', installDir: join(root, 'shared-platform'), version: 'v1.0.0' },
      },
    ]);
    await service.updatePlatform('ins-1', 'v2.0.0');

    // 未恢复遗留备份（仍留在缓存中），按首次安装完成。
    const entries = await readdir(join(root, 'platform'));
    expect(entries).toContain('index.mjs');
    const staleConfig = join(root, '.update-cache-stale', 'existing', 'config', 'onebot.json');
    await expect(readFile(staleConfig, 'utf8')).resolves.toBe('{"foreign":true}');
  });

  it('getPlatformInfo returns releases from the platform repository', async () => {
    githubHelpers.fetchReleases.mockResolvedValue([
      {
        tag_name: 'v2.0.0',
        name: 'v2',
        body: null,
        published_at: null,
        prerelease: false,
        assets: [],
      },
    ]);
    const { service } = createService(root);
    const info = await service.getPlatformInfo('ins-1');
    expect(info.installed).toBe(true);
    expect(info.currentVersion).toBe('v1.0.0');
    expect(info.releases[0].tag_name).toBe('v2.0.0');
    expect(githubHelpers.fetchReleases).toHaveBeenCalledWith([], 'SnowLuma/SnowLuma');
  });
});
