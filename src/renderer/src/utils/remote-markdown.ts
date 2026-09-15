import DOMPurify from 'dompurify';
import { marked } from 'marked';

const renderer = new marked.Renderer();

// 远程 Markdown 中的原始 HTML 没有展示许可协议所需的语义，直接丢弃而非交给浏览器解释。
renderer.html = () => '';
renderer.image = (_href, _title, text) => escapeHtml(text);
renderer.link = (href, title, text) => {
  const safeHref = normalizeHttpsUrl(href);
  if (!safeHref) return text;
  const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : '';
  return `<a href="${escapeAttribute(safeHref)}"${titleAttribute}>${text}</a>`;
};

/** 把不可信远程 Markdown 收敛为许可页面允许的少量静态 HTML。 */
export function renderRemoteMarkdown(source: string): string {
  const rendered = marked.parse(source, {
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  });
  if (typeof rendered !== 'string') throw new Error('Markdown renderer unexpectedly became async');
  return DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: [
      'a',
      'blockquote',
      'br',
      'code',
      'del',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'li',
      'ol',
      'p',
      'pre',
      'strong',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'ul',
    ],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['form', 'iframe', 'object', 'script', 'style', 'svg', 'template'],
    RETURN_TRUSTED_TYPE: false,
  });
}

/** 许可正文中的链接只允许交给系统浏览器打开 HTTPS 地址。 */
export function normalizeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtml(value: string): string {
  return escapeAttribute(value).replaceAll("'", '&#39;');
}
