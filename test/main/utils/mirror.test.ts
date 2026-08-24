import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MirrorSource } from '../../../src/shared/domain/mirror';
import {
  githubMirrorsOf,
  resolveGithubUrl,
  tryEachGithubMirror,
} from '../../../src/main/utils/mirror';
import { fetchRepositoryFile } from '../../../src/main/utils/github-installer';

const MIRRORS: readonly MirrorSource[] = [
  { id: 'gh-direct', type: 'github', name: 'GitHub', baseUrl: 'https://github.com' },
  { id: 'gh-proxy', type: 'github', name: 'GitHub Proxy', baseUrl: 'https://ghproxy.net' },
  { id: 'py-tuna', type: 'python-ftp', name: 'TUNA', baseUrl: 'https://pypi.tuna.tsinghua.edu.cn' },
];

describe('mirror utils', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('filters github mirrors from the full list', () => {
    expect(githubMirrorsOf(MIRRORS).map((m) => m.id)).toEqual(['gh-direct', 'gh-proxy']);
  });

  it('resolves direct and proxied urls', () => {
    expect(resolveGithubUrl(MIRRORS[0], 'https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(resolveGithubUrl(MIRRORS[1], 'https://github.com/a/b')).toBe(
      'https://ghproxy.net/https://github.com/a/b',
    );
  });

  it('tries mirrors in order and uses the first success', async () => {
    const attempts: string[] = [];
    const result = await tryEachGithubMirror(
      MIRRORS,
      undefined,
      async (mirror) => {
        attempts.push(mirror.id);
        if (mirror.id === 'gh-proxy') return 'ok';
        throw new Error('fail');
      },
      'all failed',
    );
    expect(result).toBe('ok');
    expect(attempts).toEqual(['gh-direct', 'gh-proxy']);
  });

  it('throws when no github mirror is available', async () => {
    await expect(
      tryEachGithubMirror([], undefined, async () => 'ok', 'no source'),
    ).rejects.toThrow('未配置任何镜像源');
  });

  it('fetchRepositoryFile polls mirrors for the requested file', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://ghproxy.net/')) {
        return { ok: true, status: 200, text: async () => 'LICENSE TEXT' };
      }
      return { ok: false, status: 404, text: async () => '' };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchRepositoryFile({
      mirrors: MIRRORS,
      repository: 'MoFox-Studio/Neo-MoFox',
      path: 'LICENSE',
    });

    expect(result.source).toBe('GitHub Proxy');
    expect(result.content).toBe('LICENSE TEXT');
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain(
      'https://ghproxy.net/https://raw.githubusercontent.com/MoFox-Studio/Neo-MoFox/main/LICENSE',
    );
  });
});