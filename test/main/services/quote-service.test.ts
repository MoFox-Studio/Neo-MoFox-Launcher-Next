import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchQuote } from '../../../src/main/services/quote-service';

/** 名言在线来源的字段映射与错误收敛；网络请求通过全局 fetch 替身模拟。 */
describe('quote-service', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps hitokoto fields to text/author/source and forwards category filters', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe('https://v1.hitokoto.cn/?c=a&c=h');
      return new Response(
        JSON.stringify({ hitokoto: ' 千里之行，始于足下。 ', from: '道德经', from_who: '老子' }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchImpl);

    await expect(fetchQuote('hitokoto', ['a', 'h'])).resolves.toEqual({
      text: '千里之行，始于足下。',
      author: '老子',
      source: '道德经',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('requests hitokoto without a query when no valid categories are given', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ hitokoto: '句子', from: '', from_who: undefined }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    const quote = await fetchQuote('hitokoto', ['x', '']);
    expect(quote).toEqual({ text: '句子', author: '', source: '' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://v1.hitokoto.cn/');
  });

  it('maps jinrishici fields to text/author/source', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ content: '海上生明月', origin: '望月怀远', author: '张九龄' }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchImpl);

    await expect(fetchQuote('jinrishici')).resolves.toEqual({
      text: '海上生明月',
      author: '张九龄',
      source: '望月怀远',
    });
  });

  it('surfaces HTTP failures as IO errors with the provider label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 503 })));
    await expect(fetchQuote('hitokoto')).rejects.toMatchObject({
      code: 'IO_ERROR',
      message: expect.stringContaining('一言'),
    });
  });

  it('surfaces network failures as IO errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(fetchQuote('jinrishici')).rejects.toMatchObject({ code: 'IO_ERROR' });
  });

  it('rejects non-object or empty payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[1,2,3]', { status: 200 })));
    await expect(fetchQuote('hitokoto')).rejects.toMatchObject({ code: 'IO_ERROR' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ hitokoto: '   ' }), { status: 200 })),
    );
    await expect(fetchQuote('hitokoto')).rejects.toMatchObject({ code: 'IO_ERROR' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    );
    await expect(fetchQuote('jinrishici')).rejects.toMatchObject({ code: 'IO_ERROR' });
  });
});
