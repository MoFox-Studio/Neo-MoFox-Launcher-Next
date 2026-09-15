// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderRemoteMarkdown } from '../../../../src/renderer/src/utils/remote-markdown';

describe('remote Markdown boundary', () => {
  it('preserves readable Markdown while rejecting executable HTML and unsafe links', () => {
    const html = renderRemoteMarkdown(
      '# Hello\n\n**World**\n\n<script>window.mofoxAPI.removeInstance("x")</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29) [plain](http://example.com) [safe](https://example.com/docs)',
    );
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('h1')?.textContent).toBe('Hello');
    expect(root.querySelector('strong')?.textContent).toBe('World');
    expect(root.querySelector('script, img, iframe, style, form')).toBeNull();
    expect([...root.querySelectorAll('a')].map((a) => a.href)).toEqual([
      'https://example.com/docs',
    ]);
    expect(html).not.toContain('removeInstance');
  });
});
