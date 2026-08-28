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
    platform: { id: 'snowluma', installDir: join(root, 'platform'), version: 'v1.0.0' },
    status: 'stopped',
    createdAt: 1,
    lastStartedAt: null,
    autoStart: false,
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
  const runtime = { stopSource: vi.fn(async () => undefined) };
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
    expect(runtime.stopSource).toHaveBeenCalledWith('ins-1', 'platform');
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
