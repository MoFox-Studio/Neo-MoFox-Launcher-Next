import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MofoxError } from '../../../src/shared/domain/error';
import {
  MAX_HOME_DOC_BYTES,
  fetchHomeRemoteDoc,
  hasDocExtension,
  isPrivateHostname,
  readHomeDoc,
} from '../../../src/main/services/home-docs-service';

/** 文档读取与远程拉取的安全边界：扩展名白名单、大小上限与内网地址拦截。 */
describe('home-docs-service', () => {
  let directory: string;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  describe('hasDocExtension', () => {
    it('accepts the allowlisted extensions case-insensitively', () => {
      expect(hasDocExtension('C:\\Docs\\guide.md')).toBe(true);
      expect(hasDocExtension('/tmp/notes.MARKDOWN')).toBe(true);
      expect(hasDocExtension('/tmp/notes.Txt')).toBe(true);
    });

    it('rejects other extensions and extension-less paths', () => {
      expect(hasDocExtension('C:\\Docs\\guide.html')).toBe(false);
      expect(hasDocExtension('C:\\Docs\\guide')).toBe(false);
      expect(hasDocExtension('C:\\Docs\\md')).toBe(false);
    });
  });

  describe('isPrivateHostname', () => {
    it('blocks localhost, loopback and private ranges', () => {
      expect(isPrivateHostname('localhost')).toBe(true);
      expect(isPrivateHostname('api.localhost')).toBe(true);
      expect(isPrivateHostname('127.0.0.1')).toBe(true);
      expect(isPrivateHostname('10.1.2.3')).toBe(true);
      expect(isPrivateHostname('192.168.1.10')).toBe(true);
      expect(isPrivateHostname('172.16.0.1')).toBe(true);
      expect(isPrivateHostname('172.31.255.255')).toBe(true);
      expect(isPrivateHostname('169.254.1.1')).toBe(true);
      expect(isPrivateHostname('100.64.0.1')).toBe(true);
      expect(isPrivateHostname('[::1]')).toBe(true);
      expect(isPrivateHostname('fe80::1')).toBe(true);
      expect(isPrivateHostname('fd00::1')).toBe(true);
      expect(isPrivateHostname('::ffff:127.0.0.1')).toBe(true);
    });

    it('blocks malformed IPv4 literals conservatively', () => {
      expect(isPrivateHostname('999.1.1.1')).toBe(true);
      expect(isPrivateHostname('1.2.3')).toBe(false);
    });

    it('allows public hostnames and addresses', () => {
      expect(isPrivateHostname('raw.githubusercontent.com')).toBe(false);
      expect(isPrivateHostname('8.8.8.8')).toBe(false);
      expect(isPrivateHostname('172.32.0.1')).toBe(false);
      expect(isPrivateHostname('2606:4700::1')).toBe(false);
    });
  });

  describe('readHomeDoc', () => {
    it('reads a markdown file with its base name', async () => {
      directory = await mkdtemp(join(tmpdir(), 'mofox-docs-'));
      const path = join(directory, 'guide.md');
      await writeFile(path, '# 你好\n正文', 'utf8');
      await expect(readHomeDoc(path)).resolves.toEqual({
        name: 'guide.md',
        content: '# 你好\n正文',
      });
    });

    it('rejects unsupported extensions before touching the filesystem', async () => {
      await expect(readHomeDoc(join(tmpdir(), 'guide.exe'))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(readHomeDoc('')).rejects.toBeInstanceOf(MofoxError);
    });

    it('reports a friendly error when the file is missing', async () => {
      directory = await mkdtemp(join(tmpdir(), 'mofox-docs-'));
      await expect(readHomeDoc(join(directory, 'missing.md'))).rejects.toMatchObject({
        code: 'IO_ERROR',
      });
    });

    it('rejects files beyond the 2 MB limit', async () => {
      directory = await mkdtemp(join(tmpdir(), 'mofox-docs-'));
      const path = join(directory, 'big.md');
      await writeFile(path, 'a'.repeat(MAX_HOME_DOC_BYTES + 1), 'utf8');
      await expect(readHomeDoc(path)).rejects.toMatchObject({ code: 'IO_ERROR' });
    });
  });

  describe('fetchHomeRemoteDoc', () => {
    it('rejects non-HTTPS and credentialed URLs without issuing requests', async () => {
      const fetchImpl = vi.fn();
      vi.stubGlobal('fetch', fetchImpl);
      await expect(fetchHomeRemoteDoc('http://example.com/a.md')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(fetchHomeRemoteDoc('https://user:pass@example.com/a.md')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(fetchHomeRemoteDoc('not a url')).rejects.toBeInstanceOf(MofoxError);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('blocks loopback and private targets without issuing requests', async () => {
      const fetchImpl = vi.fn();
      vi.stubGlobal('fetch', fetchImpl);
      await expect(fetchHomeRemoteDoc('https://localhost/notes.md')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(fetchHomeRemoteDoc('https://192.168.1.5/notes.md')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(fetchHomeRemoteDoc('https://[::1]/notes.md')).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('fetches a public HTTPS document and derives the display name', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('# 远程文档\n内容', { status: 200 })),
      );
      const result = await fetchHomeRemoteDoc('https://example.com/docs/%E6%8C%87%E5%8D%97.md');
      expect(result.name).toBe('指南.md');
      expect(result.content).toBe('# 远程文档\n内容');
    });

    it('falls back to the hostname when the URL has no file segment', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('内容', { status: 200 })));
      const result = await fetchHomeRemoteDoc('https://example.com/');
      expect(result.name).toBe('example.com');
    });

    it('reports HTTP failures as IO errors', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
      await expect(fetchHomeRemoteDoc('https://example.com/a.md')).rejects.toMatchObject({
        code: 'IO_ERROR',
      });
    });

    it('rejects bodies beyond the size limit while streaming', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('a'.repeat(MAX_HOME_DOC_BYTES + 1), { status: 200 })),
      );
      await expect(fetchHomeRemoteDoc('https://example.com/a.md')).rejects.toMatchObject({
        code: 'IO_ERROR',
        message: expect.stringContaining('2 MB'),
      });
    });

    it('follows HTTPS redirects but rejects redirect targets on private hosts', async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, { status: 302, headers: { location: 'https://internal.example/a.md' } }),
        )
        .mockResolvedValueOnce(new Response('内容', { status: 200 }));
      vi.stubGlobal('fetch', fetchImpl);
      const result = await fetchHomeRemoteDoc('https://example.com/a.md');
      expect(result.content).toBe('内容');

      const redirecting = vi.fn().mockResolvedValue(
        new Response(null, { status: 301, headers: { location: 'https://192.168.0.10/a.md' } }),
      );
      vi.stubGlobal('fetch', redirecting);
      await expect(fetchHomeRemoteDoc('https://example.com/a.md')).rejects.toMatchObject({
        code: 'IO_ERROR',
      });
    });
  });
});

// pickHomeDocs 依赖 Electron dialog，仅验证已注册的处理器通道由 ipc/home 的测试覆盖；
// 此处额外确认大小上限常量保持为 2 MB，防止无意放宽。
describe('home doc limits', () => {
  it('keeps the 2 MB cap', () => {
    expect(MAX_HOME_DOC_BYTES).toBe(2 * 1024 * 1024);
  });

  it('stat remains importable for fs-driven flows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mofox-docs-stat-'));
    const path = join(directory, 'x.md');
    await writeFile(path, 'x', 'utf8');
    const info = await stat(path);
    expect(info.isFile()).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });
});
