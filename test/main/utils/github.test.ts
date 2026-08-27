import { describe, expect, it, vi, afterEach } from 'vitest';
import type { MirrorSource } from '../../../src/shared/domain/mirror';
import { fetchReleases, installGithubRelease } from '../../../src/main/utils/git/github';
import { describeHttpStatus } from '../../../src/main/utils/http-status';
import type { InstallContext } from '../../../src/shared/domain/bot-platform';

vi.mock('extract-zip', () => ({
  __esModule: true,
  default: vi.fn(async () => undefined),
}));

vi.mock('../../../src/main/utils/range-downloader', () => ({
  downloadRange: vi.fn(async () => undefined),
}));

const MIRRORS: readonly MirrorSource[] = [
  { id: 'gh-direct', type: 'github', name: 'GitHub', baseUrl: 'https://github.com' },
  { id: 'gh-proxy', type: 'github', name: 'GitHub Proxy', baseUrl: 'https://ghproxy.net' },
];

function releasePayload(tag: string): Record<string, unknown> {
  return {
    tag_name: tag,
    name: tag,
    body: 'release body',
    published_at: '2026-08-01T00:00:00Z',
    prerelease: false,
    assets: [{ name: `app-${tag}.zip`, browser_download_url: `https://example.com/${tag}.zip` }],
  };
}

function installContext(version = 'latest'): InstallContext {
  return {
    instanceId: 'ins-1',
    version,
    workDir: '/tmp/work',
    targetDir: '/tmp/target',
    mirrors: MIRRORS,
  };
}

describe('describeHttpStatus', () => {
  it('explains common status codes', () => {
    expect(describeHttpStatus(403)).toContain('访问被拒绝');
    expect(describeHttpStatus(404)).toContain('资源不存在');
    expect(describeHttpStatus(429)).toContain('限流');
    expect(describeHttpStatus(503)).toContain('服务暂时不可用');
  });

  it('falls back for unknown status codes', () => {
    expect(describeHttpStatus(599)).toBe('未知的 HTTP 状态码');
  });
});

describe('fetchReleases', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the parsed release list from the first successful mirror', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://ghproxy.net/')) {
        return {
          ok: true,
          status: 200,
          json: async () => [releasePayload('v1'), releasePayload('v2')],
        };
      }
      return { ok: false, status: 404, json: async () => null };
    });
    vi.stubGlobal('fetch', fetchMock);

    const releases = await fetchReleases(MIRRORS, 'SnowLuma/SnowLuma');
    expect(releases.map((r) => r.tag_name)).toEqual(['v1', 'v2']);
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain(
      'https://ghproxy.net/https://api.github.com/repos/SnowLuma/SnowLuma/releases?per_page=20',
    );
  });

  it('throws when every mirror fails to fetch releases', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => null })),
    );
    await expect(fetchReleases(MIRRORS, 'SnowLuma/SnowLuma')).rejects.toThrow(
      '所有镜像均无法获取 SnowLuma/SnowLuma 发行版列表',
    );
  });
});

describe('installGithubRelease', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests the latest release when version is "latest"', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('releases/latest')) {
          return { ok: true, status: 200, json: async () => releasePayload('v9') };
        }
        return { ok: false, status: 404, json: async () => null };
      }),
    );
    const result = await installGithubRelease(
      installContext('latest'),
      MIRRORS,
      'SnowLuma/SnowLuma',
      (release) => ({
        name: `${release.tag_name}.zip`,
        browser_download_url: 'https://example.com/x.zip',
      }),
      async () => true,
    );
    expect(result.version).toBe('v9');
    expect(urls.some((url) => url.includes('releases/latest'))).toBe(true);
  });

  it('requests the tagged release when a specific version is requested', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('releases/tags/v1.2.3')) {
          return { ok: true, status: 200, json: async () => releasePayload('v1.2.3') };
        }
        return { ok: false, status: 404, json: async () => null };
      }),
    );
    const result = await installGithubRelease(
      installContext('v1.2.3'),
      MIRRORS,
      'SnowLuma/SnowLuma',
      (release) => ({
        name: `${release.tag_name}.zip`,
        browser_download_url: 'https://example.com/x.zip',
      }),
      async () => true,
    );
    expect(result.version).toBe('v1.2.3');
    expect(urls.some((url) => url.includes('releases/tags/v1.2.3'))).toBe(true);
  });
});
