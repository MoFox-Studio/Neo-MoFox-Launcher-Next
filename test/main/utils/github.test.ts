import { describe, expect, it, vi, afterEach } from 'vitest';
import type { MirrorSource } from '../../../src/shared/domain/mirror';
import { fetchReleases, installGithubRelease } from '../../../src/main/utils/git/github';
import { describeGitError, describeNetworkError } from '../../../src/main/utils/network-error';
import type { InstallContext } from '../../../src/shared/domain/bot-platform';

vi.mock('../../../src/main/utils/zip-extractor', () => ({
  extractZipSecurely: vi.fn(async () => undefined),
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

describe('describeNetworkError', () => {
  it('explains common HTTP status codes', () => {
    expect(describeNetworkError(403)).toContain('访问被拒绝');
    expect(describeNetworkError(404)).toContain('资源不存在');
    expect(describeNetworkError(429)).toContain('限流');
    expect(describeNetworkError(503)).toContain('服务暂时不可用');
  });

  it('explains TLS certificate verification failures by error code and message', () => {
    const byCode = Object.assign(new Error('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    });
    expect(describeNetworkError(byCode)).toContain('证书');
    expect(describeNetworkError(new Error('self-signed certificate'))).toContain('证书');
    expect(describeNetworkError(new Error('certificate has expired'))).toContain('过期');
  });

  it('unwraps the underlying cause for fetch network failures', () => {
    const wrapped = new TypeError('fetch failed', {
      cause: Object.assign(new Error('unable to verify the first certificate'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      }),
    });
    expect(describeNetworkError(wrapped)).toContain('证书');
  });

  it('explains DNS and connection failures', () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' });
    expect(describeNetworkError(dns)).toContain('域名解析');
    const refused = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), {
      code: 'ECONNREFUSED',
    });
    expect(describeNetworkError(refused)).toContain('连接被拒绝');
    const timeout = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect(describeNetworkError(timeout)).toContain('超时');
  });

  it('explains aborted requests', () => {
    expect(describeNetworkError(new DOMException('This operation was aborted', 'AbortError'))).toContain(
      '取消',
    );
  });

  it('falls back for unknown inputs', () => {
    expect(describeNetworkError(599)).toBe('未知的 HTTP 状态码 599');
    expect(describeNetworkError(new Error('something unexpected'))).toBe('未知的网络错误（something unexpected）');
  });
});

describe('describeGitError', () => {
  it('explains certificate, auth and missing repository errors', () => {
    expect(
      describeGitError(
        "fatal: unable to access 'https://github.com/x.git/': SSL certificate problem: unable to get local issuer certificate",
      ),
    ).toContain('证书');
    expect(describeGitError("fatal: Authentication failed for 'https://github.com/x.git/'")).toContain(
      '认证',
    );
    expect(describeGitError("fatal: repository 'https://github.com/foo/bar.git/' not found")).toContain(
      '仓库不存在',
    );
  });

  it('explains network-level failures reported by git', () => {
    expect(
      describeGitError(
        "fatal: unable to access 'https://github.com/x.git/': Failed to connect to github.com port 443: Connection refused",
      ),
    ).toContain('连接被拒绝');
    expect(describeGitError("fatal: unable to access 'https://github.com/x.git/': Could not resolve host: github.com")).toContain(
      '域名解析',
    );
  });

  it('explains local repository problems', () => {
    expect(describeGitError('fatal: not a git repository (or any of the parent directories)')).toContain(
      'Git 仓库',
    );
    expect(
      describeGitError("fatal: destination path '/x' already exists and is not an empty directory."),
    ).toContain('已存在');
  });

  it('falls back to the raw output when unrecognized', () => {
    expect(describeGitError(undefined)).toBe('未知的 Git 错误');
    expect(describeGitError('fatal: some weird error')).toBe('fatal: some weird error');
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
