import { BrowserWindow, dialog } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { HomeDocContent, HomeDocEntry } from '../../shared/domain/home';
import { MofoxError } from '../../shared/domain/error';

/**
 * 主页文档部件的主进程能力：本地文档选择与读取、远程文档拉取。
 *
 * 安全面收敛为：本地仅允许 Markdown/纯文本扩展名且不超过大小上限；
 * 远程仅接受无凭据的 HTTPS 链接，拒绝内网与本机地址，响应大小同样受限。
 */

/** 允许阅读的文档扩展名（不含点）。 */
export const HOME_DOC_EXTENSIONS = ['md', 'markdown', 'txt'] as const;

/** 单个文档正文的大小上限。 */
export const MAX_HOME_DOC_BYTES = 2 * 1024 * 1024;

/** 远程文档请求的超时时间。 */
const REMOTE_DOC_TIMEOUT_MS = 15_000;

/**
 * 通过系统对话框选择若干本地文档，并转换为可持久化的条目元数据。
 *
 * 不满足扩展名或不是常规文件的路径会被静默跳过；用户取消时返回空数组。
 *
 * @param getWindow - 返回当前主窗口的回调；窗口不存在时返回 `null`。
 * @returns 选中的文档条目列表。
 */
export async function pickHomeDocs(
  getWindow: () => BrowserWindow | null,
): Promise<HomeDocEntry[]> {
  const window = getWindow();
  if (!window || window.isDestroyed()) return [];
  const result = await dialog.showOpenDialog(window, {
    title: '选择文档',
    filters: [{ name: 'Markdown 文档', extensions: [...HOME_DOC_EXTENSIONS] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  const entries: HomeDocEntry[] = [];
  for (const path of result.filePaths) {
    if (!hasDocExtension(path)) continue;
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) continue;
    entries.push({ id: randomUUID(), kind: 'local', name: basename(path), path });
  }
  return entries;
}

/**
 * 读取本地文档的 UTF-8 正文。
 *
 * @param path - 文档的绝对路径。
 * @returns 文档名与正文内容。
 * @throws {MofoxError} 路径非法、扩展名不受支持、文件缺失或超过大小上限时抛出。
 */
export async function readHomeDoc(path: string): Promise<HomeDocContent> {
  if (typeof path !== 'string' || !path.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', '文档路径无效');
  }
  if (!hasDocExtension(path)) {
    throw new MofoxError('INVALID_ARGUMENT', '仅支持 Markdown 或纯文本文档');
  }
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) {
    throw new MofoxError('IO_ERROR', '文档文件不存在或不可访问');
  }
  if (info.size > MAX_HOME_DOC_BYTES) {
    throw new MofoxError('IO_ERROR', '文档超过 2 MB 大小限制');
  }
  const content = await readFile(path, 'utf8');
  return { name: basename(path), content };
}

/**
 * 拉取远程文档的正文。
 *
 * 仅接受无凭据的 HTTPS 链接；重定向目标同样必须是可访问的 HTTPS 地址，
 * 本机、局域网与保留地址一律拒绝，正文超过大小上限时拒绝返回。
 *
 * @param url - 远程文档链接。
 * @returns 展示名（链接末段或主机名）与正文内容。
 * @throws {MofoxError} 链接非法、网络失败或正文超过大小上限时抛出。
 */
export async function fetchHomeRemoteDoc(url: string): Promise<HomeDocContent> {
  const parsed = parseRemoteDocUrl(url);
  const response = await requestWithRedirects(parsed, 5);
  if (!response.ok) {
    throw new MofoxError('IO_ERROR', `远程文档请求失败：HTTP ${response.status}`);
  }
  const content = await readTextCapped(response, MAX_HOME_DOC_BYTES);
  return { name: deriveRemoteDocName(parsed), content };
}

/**
 * 判断路径是否携带受支持的文档扩展名（大小写不敏感）。
 *
 * @param path - 待检查的路径。
 * @returns 扩展名受支持时返回 `true`。
 */
export function hasDocExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return HOME_DOC_EXTENSIONS.some((extension) => lower.endsWith(`.${extension}`));
}

/**
 * 校验并解析远程文档链接。
 *
 * @param url - 待校验的链接。
 * @returns 解析后的 URL 对象。
 * @throws {MofoxError} 链接为空、非 HTTPS、携带凭据或指向内网时抛出。
 */
function parseRemoteDocUrl(url: string): URL {
  if (typeof url !== 'string' || !url.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', '远程文档链接无效');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MofoxError('INVALID_ARGUMENT', '远程文档链接无效');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new MofoxError('INVALID_ARGUMENT', '远程文档链接必须使用无凭据的 HTTPS 地址');
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new MofoxError('INVALID_ARGUMENT', '不允许访问本机或内网地址');
  }
  return parsed;
}

/**
 * 发起远程文档请求并手动跟随 HTTPS 重定向。
 *
 * @param initial - 初始 URL。
 * @param maxRedirects - 允许的最大重定向次数。
 * @returns 最终响应。
 * @throws {MofoxError} 网络失败、重定向无效或次数过多时抛出。
 */
async function requestWithRedirects(initial: URL, maxRedirects: number): Promise<Response> {
  let current = initial;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(REMOTE_DOC_TIMEOUT_MS),
        headers: { 'User-Agent': 'Neo-MoFox-Launcher' },
      });
    } catch (error) {
      if (error instanceof MofoxError) throw error;
      throw new MofoxError('IO_ERROR', `远程文档请求失败：${describeNetworkError(error)}`);
    }
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location || redirects === maxRedirects) {
      throw new MofoxError('IO_ERROR', '远程文档重定向无效或次数过多');
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new MofoxError('IO_ERROR', '远程文档重定向地址无效');
    }
    if (next.protocol !== 'https:' || isPrivateHostname(next.hostname)) {
      throw new MofoxError('IO_ERROR', '远程文档重定向目标不受支持');
    }
    current = next;
  }
  throw new MofoxError('IO_ERROR', '远程文档重定向次数过多');
}

/** 以流式方式读取响应正文，超过上限时立即中止。 */
async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new MofoxError('IO_ERROR', '远程文档响应正文为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new MofoxError('IO_ERROR', '远程文档超过 2 MB 大小限制');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 从链接末段推导文档展示名；无路径段时回退主机名。 */
function deriveRemoteDocName(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean).pop();
  let name: string;
  try {
    name = segment ? decodeURIComponent(segment) : '';
  } catch {
    name = segment ?? '';
  }
  if (!name) name = url.hostname;
  // 控制字符与过长名称一律收敛，保证设置文件与界面展示安全。
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1f\x7f]/g, '');
  return name.length > 80 ? `${name.slice(0, 77)}...` : name;
}

/** 将未知网络异常收敛为可读描述。 */
function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return '请求超时';
    return error.message;
  }
  return String(error);
}

/**
 * 判断主机名是否为本机、链路本地、私网或保留地址。
 *
 * @param rawHostname - URL 中的主机名（IPv6 可能带方括号）。
 * @returns 属于受限地址时返回 `true`。
 */
export function isPrivateHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '::' || hostname === '::1') return true;
  if (hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) {
    return true;
  }
  if (hostname.startsWith('::ffff:')) return isPrivateIPv4(hostname.slice('::ffff:'.length));
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return isPrivateIPv4(hostname);
  return false;
}

/** 判断 IPv4 字面量是否位于私网、回环或保留段；无法解析时保守视为受限。 */
function isPrivateIPv4(value: string): boolean {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part > 255)) {
    return true;
  }
  const [first, second] = parts as [number, number, number, number];
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return first >= 224;
}
