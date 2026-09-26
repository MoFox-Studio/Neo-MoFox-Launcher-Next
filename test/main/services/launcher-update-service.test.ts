import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GithubRelease } from '../../../src/shared/domain/github';
import type { LauncherBuildInfo } from '../../../src/shared/domain/app-update';
import {
  LauncherUpdateService,
  isNewerRelease,
  parseNightlyBuildDate,
} from '../../../src/main/services/launcher-update-service';

/** 构造一份每夜构建描述的本地构建信息。 */
function nightlyBuild(buildDate: string): LauncherBuildInfo {
  return {
    version: '0.1.0',
    channel: 'nightly',
    buildDate,
    tag: `nightly-${buildDate}`,
    commit: '3d68ddc',
  };
}

/** 构造最小可用的 GitHub Release 元数据。 */
function release(
  tag: string,
  name: string | null = null,
  body: string | null = null,
): GithubRelease {
  return {
    tag_name: tag,
    name,
    body,
    published_at: '2026-09-26T16:05:00Z',
    prerelease: true,
    assets: [],
  };
}

describe('parseNightlyBuildDate', () => {
  it('extracts the 8-digit build date from nightly tags', () => {
    expect(parseNightlyBuildDate('nightly-20260926')).toBe('20260926');
  });

  it('returns null for non-nightly or malformed tags', () => {
    expect(parseNightlyBuildDate('v0.2.0')).toBeNull();
    expect(parseNightlyBuildDate('nightly-2026-09-26')).toBeNull();
    expect(parseNightlyBuildDate('nightly-20260926-beta')).toBeNull();
  });
});

describe('isNewerRelease', () => {
  it('compares nightly builds by build date within the same channel', () => {
    const current = nightlyBuild('20260926');
    expect(isNewerRelease('nightly-20260927', current)).toBe(true);
    expect(isNewerRelease('nightly-20260926', current)).toBe(false);
    expect(isNewerRelease('nightly-20260925', current)).toBe(false);
  });

  it('does not offer nightly updates to dev builds', () => {
    const dev = nightlyBuild('20260926');
    dev.channel = 'dev';
    dev.buildDate = '';
    expect(isNewerRelease('nightly-20991231', dev)).toBe(false);
  });

  it('treats non-nightly tags as not newer regardless of the local version', () => {
    const current = nightlyBuild('20260926');
    current.version = '20260926';
    expect(isNewerRelease('v0.2.0', current)).toBe(false);
    expect(isNewerRelease('some-random-tag', current)).toBe(false);
  });
});

describe('LauncherUpdateService', () => {
  /** 版本号文件测试目录；默认作为 searchPaths，需要每夜构建语义的用例自行写入文件。 */
  let buildInfoDir: string;

  beforeAll(async () => {
    buildInfoDir = await mkdtemp(join(tmpdir(), 'mofox-build-info-'));
  });

  afterAll(async () => {
    await rm(buildInfoDir, { recursive: true, force: true });
  });

  /** 构造一份每夜构建版本号文件的 JSON 文本。 */
  const nightlyVersionFile = (buildDate: string): string =>
    JSON.stringify({
      channel: 'nightly',
      buildDate,
      tag: `nightly-${buildDate}`,
      commit: '3d68ddc',
    });

  /** 依赖与 fetch 替身的组装工具。 */
  function createService(options: {
    releases: GithubRelease[];
    searchPaths?: string[];
    appVersion?: string;
  }) {
    const fetchReleasesImpl = vi.fn(async () => options.releases);
    const report = vi.fn();
    const service = new LauncherUpdateService({
      mirrors: { list: () => [] },
      searchPaths: options.searchPaths ?? [buildInfoDir],
      appVersion: options.appVersion ?? '0.1.0',
      fetchReleasesImpl,
      report,
    });
    return { service, fetchReleasesImpl, report };
  }

  it('reports an update with release notes when a newer nightly exists', async () => {
    await writeFile(join(buildInfoDir, 'version.json'), nightlyVersionFile('20260926'), 'utf8');
    const { service } = createService({
      releases: [
        release('nightly-20260927', '🌙 每夜构建 20260927', '## 修复内容'),
        release('nightly-20260926'),
      ],
    });
    const info = await service.checkForUpdates();
    expect(info.updateAvailable).toBe(true);
    expect(info.latestTag).toBe('nightly-20260927');
    expect(info.latestVersion).toBe('🌙 每夜构建 20260927');
    expect(info.latestBuildDate).toBe('20260927');
    expect(info.releaseNotes).toBe('## 修复内容');
    expect(info.releaseUrl).toBe(
      'https://github.com/MoFox-Studio/Neo-MoFox-Launcher-Next/releases/tag/nightly-20260927',
    );
    expect(info.current.buildDate).toBe('20260926');
  });

  it('returns an empty result when nothing is newer', async () => {
    await writeFile(join(buildInfoDir, 'version.json'), nightlyVersionFile('20260926'), 'utf8');
    const { service } = createService({
      releases: [release('nightly-20260926'), release('not-a-tag')],
    });
    const info = await service.checkForUpdates();
    expect(info.updateAvailable).toBe(false);
    expect(info.latestTag).toBe('');
    expect(info.releaseUrl).toBe('');
  });

  it('skips unparseable releases and picks the first usable newer one', async () => {
    await writeFile(join(buildInfoDir, 'version.json'), nightlyVersionFile('20260926'), 'utf8');
    const { service } = createService({
      releases: [
        release('not-a-tag'),
        release('v1.2.3'),
        release('nightly-19990101'),
        release('nightly-20260928'),
      ],
    });
    const info = await service.checkForUpdates();
    expect(info.updateAvailable).toBe(true);
    expect(info.latestTag).toBe('nightly-20260928');
    expect(info.latestBuildDate).toBe('20260928');
  });

  it('caches the build info across checks', async () => {
    await writeFile(join(buildInfoDir, 'version.json'), nightlyVersionFile('20260926'), 'utf8');
    const { service } = createService({ releases: [] });
    const first = await service.getBuildInfo();
    const second = await service.getBuildInfo();
    expect(first).toEqual(second);
    expect(second).not.toBe(first);
  });

  it('prefers the version declared in the build info file over package.json', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mofox-update-'));
    try {
      await writeFile(
        join(directory, 'version.json'),
        JSON.stringify({
          version: '20260926',
          channel: 'nightly',
          buildDate: '20260926',
          tag: 'nightly-20260926',
          commit: '3d68ddc',
        }),
        'utf8',
      );
      const { service } = createService({
        releases: [],
        searchPaths: [directory],
        appVersion: '0.1.0',
      });
      const info = await service.getBuildInfo();
      expect(info.version).toBe('20260926');
      expect(info.channel).toBe('nightly');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reads version.json from the first candidate directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mofox-update-'));
    try {
      await writeFile(
        join(directory, 'version.json'),
        JSON.stringify({
          channel: 'nightly',
          buildDate: '20260926',
          tag: 'nightly-20260926',
          commit: '3d68ddc',
        }),
        'utf8',
      );
      const { service, report } = createService({
        releases: [],
        searchPaths: [directory],
        appVersion: '0.2.0',
      });
      const info: LauncherBuildInfo = await service.getBuildInfo();
      expect(info).toEqual({
        version: '0.2.0',
        channel: 'nightly',
        buildDate: '20260926',
        tag: 'nightly-20260926',
        commit: '3d68ddc',
      });
      expect(report).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('falls back to a dev build description when the file is missing', async () => {
    const missingDirectory = join(tmpdir(), `mofox-missing-${Date.now()}`);
    const { service, report } = createService({
      releases: [],
      searchPaths: [missingDirectory],
      appVersion: '0.1.0',
    });
    const info = await service.getBuildInfo();
    expect(info).toEqual({
      version: '0.1.0',
      channel: 'dev',
      buildDate: '',
      tag: '',
      commit: '',
    });
    expect(report).not.toHaveBeenCalled();
  });

  it('ignores malformed version files and reports a diagnostic', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mofox-update-'));
    try {
      await writeFile(join(directory, 'version.json'), '{ not json', 'utf8');
      const { service, report } = createService({
        releases: [],
        searchPaths: [directory],
        appVersion: '0.1.0',
      });
      const info = await service.getBuildInfo();
      expect(info.channel).toBe('dev');
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a nightly channel without a valid build date', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mofox-update-'));
    try {
      await writeFile(
        join(directory, 'version.json'),
        JSON.stringify({ channel: 'nightly', buildDate: '2026-09-26' }),
        'utf8',
      );
      const { service, report } = createService({
        releases: [],
        searchPaths: [directory],
        appVersion: '0.1.0',
      });
      const info = await service.getBuildInfo();
      expect(info.channel).toBe('dev');
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects unknown channel values and falls back to a dev build', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mofox-update-'));
    try {
      await writeFile(
        join(directory, 'version.json'),
        JSON.stringify({ channel: 'stable', buildDate: '20260926' }),
        'utf8',
      );
      const { service, report } = createService({
        releases: [],
        searchPaths: [directory],
        appVersion: '0.1.0',
      });
      const info = await service.getBuildInfo();
      expect(info).toEqual({
        version: '0.1.0',
        channel: 'dev',
        buildDate: '',
        tag: '',
        commit: '',
      });
      expect(report).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
