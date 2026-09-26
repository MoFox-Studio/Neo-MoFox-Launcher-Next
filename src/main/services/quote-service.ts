import type { Quote, QuoteProviderId } from '../../shared/domain/home';
import { HITOKOTO_CATEGORY_IDS } from '../../shared/domain/home';
import { MofoxError } from '../../shared/domain/error';

/**
 * 名言部件的在线来源实现。
 *
 * 当前内置两个无需鉴权的中文一言服务：一言（hitokoto.cn）与今日诗词。
 * 请求由主进程代理，渲染层不直接访问外部网络；分类过滤仅对一言生效。
 */

/** 名言接口请求的超时时间。 */
const QUOTE_TIMEOUT_MS = 10_000;

/**
 * 从指定在线来源获取一条名言。
 *
 * @param provider - 名言来源。
 * @param categories - 一言分类过滤；空数组或包含非法分类时按未过滤处理。
 * @returns 名言正文与可选的作者、出处（缺失时为空字符串）。
 * @throws {MofoxError} 网络失败、响应无效或正文为空时抛出 `IO_ERROR`。
 */
export async function fetchQuote(
  provider: QuoteProviderId,
  categories: readonly string[] = [],
): Promise<Quote> {
  if (provider === 'hitokoto') return fetchHitokoto(categories);
  return fetchJinrishici();
}

/** 调用一言接口获取句子；`from_who` 映射作者，`from` 映射出处。 */
async function fetchHitokoto(categories: readonly string[]): Promise<Quote> {
  const query = new URLSearchParams();
  for (const category of categories) {
    if ((HITOKOTO_CATEGORY_IDS as readonly string[]).includes(category)) query.append('c', category);
  }
  const suffix = [...query.keys()].length > 0 ? `?${query.toString()}` : '';
  const data = await requestJson(`https://v1.hitokoto.cn/${suffix}`, '一言');
  const text = readText(data.hitokoto);
  if (!text) throw new MofoxError('IO_ERROR', '一言接口返回了无法识别的数据');
  return {
    text,
    author: readText(data.from_who),
    source: readText(data.from),
  };
}

/** 调用今日诗词接口获取诗句；`origin` 映射出处，`author` 映射作者。 */
async function fetchJinrishici(): Promise<Quote> {
  const data = await requestJson('https://v1.jinrishici.com/all.json', '今日诗词');
  const text = readText(data.content);
  if (!text) throw new MofoxError('IO_ERROR', '今日诗词接口返回了无法识别的数据');
  return {
    text,
    author: readText(data.author),
    source: readText(data.origin),
  };
}

/** 发起 JSON 请求并统一收敛网络、HTTP 与解析错误。 */
async function requestJson(url: string, label: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': 'Neo-MoFox-Launcher' },
    });
  } catch (error) {
    if (error instanceof MofoxError) throw error;
    throw new MofoxError('IO_ERROR', `${label}接口请求失败：${describeNetworkError(error)}`);
  }
  if (!response.ok) {
    throw new MofoxError('IO_ERROR', `${label}接口请求失败：HTTP ${response.status}`);
  }
  try {
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('响应不是对象');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new MofoxError('IO_ERROR', `${label}接口返回了无效的数据`);
  }
}

/** 读取字符串字段并去除首尾空白；非字符串或为空时返回空字符串。 */
function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 将未知网络异常收敛为可读描述。 */
function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return '请求超时';
    return error.message;
  }
  return String(error);
}
