import type { MirrorSource } from '../../shared/domain/mirror';
import { MofoxError } from '../../shared/domain/error';

/**
 * 通用的 GitHub 镜像轮询工具：下载、克隆与文件拉取统一按镜像顺序尝试，首个成功即采用。
 * 仅消费 `github` 类型镜像，`python-ftp` 类镜像留给依赖安装阶段使用。
 */

/**
 * 过滤出可用于 GitHub 请求的镜像源列表。
 *
 * @param mirrors - 全部镜像源。
 * @returns 仅保留 `github` 类型的镜像源。
 */
export function githubMirrorsOf(mirrors: readonly MirrorSource[]): MirrorSource[] {
  return mirrors.filter((mirror) => mirror.type === 'github');
}

/**
 * 根据镜像类型解析实际请求地址。
 *
 * 直连镜像使用原始地址；代理镜像以 `${baseUrl}/${originalUrl}` 形式包装。
 *
 * @param mirror - 当前镜像源。
 * @param originalUrl - GitHub 原始地址。
 * @returns 用于发起请求或克隆的最终地址。
 */
export function resolveGithubUrl(mirror: MirrorSource, originalUrl: string): string {
  if (mirror.baseUrl === 'https://github.com') return originalUrl;
  return `${mirror.baseUrl}/${originalUrl}`;
}

/**
 * 顺序尝试每个 GitHub 镜像执行指定操作，首个成功即采用。
 *
 * @param mirrors - 仅消费 `github` 类型的镜像列表。
 * @param signal - 可选的取消信号；触发后立即抛出当前错误。
 * @param run - 针对单个镜像执行的异步操作，接收镜像源本身以自行构造地址。
 * @param failureMessage - 所有镜像均失败时兜底的错误描述。
 * @returns 首个成功镜像的操作结果。
 * @throws {MofoxError} 镜像列表为空时抛 `UNAVAILABLE`；全部失败时抛出最后一个错误。
 */
export async function tryEachGithubMirror<T>(
  mirrors: readonly MirrorSource[],
  signal: AbortSignal | undefined,
  run: (mirror: MirrorSource) => Promise<T>,
  failureMessage: string,
): Promise<T> {
  const sources = githubMirrorsOf(mirrors);
  if (sources.length === 0) throw new MofoxError('UNAVAILABLE', '未配置任何镜像源');
  let lastError: unknown;
  for (const mirror of sources) {
    try {
      return await run(mirror);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new MofoxError('IO_ERROR', failureMessage);
}
