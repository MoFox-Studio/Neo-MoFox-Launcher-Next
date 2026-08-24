import type { MirrorSource } from '../../shared/domain/mirror';
import { MofoxError } from '../../shared/domain/error';
import { buildSpawnEnv } from './platform-helper';
import { runOneShot } from './process-service';
import { githubMirrorsOf, resolveGithubUrl } from './mirror';

/** Git 克隆的入参；仓库与分支来自调用方，镜像列表由调用方注入。 */
export interface CloneRepositoryOptions {
  /** 全部镜像源，内部只使用 `github` 类型并按序轮询。 */
  mirrors: readonly MirrorSource[];
  /** GitHub 仓库的 `owner/repo` 字符串。 */
  repository: string;
  /** 要克隆的分支名（如 `main`、`dev`）。 */
  branch: string;
  /** 克隆目标目录的绝对路径。 */
  destination: string;
  /** 可选的取消信号；触发后立即抛出当前错误。 */
  signal?: AbortSignal;
  /** 可选的进度回调，用于把每次镜像尝试与 git 输出转发给调用方。 */
  onProgress?: (message: string) => void;
}

/**
 * 通过 Git 克隆指定仓库的指定分支，并按 GitHub 镜像顺序轮询。
 *
 * 每个镜像构造一次克隆 URL，首个成功即采用；使用浅克隆以减小下载体积。
 *
 * @param options - 克隆参数（镜像、仓库、分支、目标目录、取消信号等）。
 * @throws {MofoxError} 镜像列表为空、全部镜像失败或 git 不可用时抛出对应错误。
 */
export async function cloneRepository(options: CloneRepositoryOptions): Promise<void> {
  const { mirrors, repository, branch, destination, signal, onProgress } = options;
  const sources = githubMirrorsOf(mirrors);
  if (sources.length === 0) throw new MofoxError('UNAVAILABLE', '未配置任何镜像源');

  let lastError: unknown;
  for (const mirror of sources) {
    try {
      const original = `https://github.com/${repository}.git`;
      const url = resolveGithubUrl(mirror, original);
      onProgress?.(`尝试镜像 ${mirror.name}: ${url}`);
      const result = await runOneShot(
        'git',
        ['clone', '--depth', '1', '-b', branch, '--single-branch', url, destination],
        {
          timeoutMs: 600_000,
          env: buildSpawnEnv(),
        },
      );
      if (result.exitCode === 0) return;
      lastError = new Error(result.stderr?.trim() || `git clone 失败 (exit ${result.exitCode})`);
      onProgress?.(`镜像 ${mirror.name} 克隆失败，尝试下一个镜像`);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new MofoxError('IO_ERROR', `所有镜像均无法克隆 ${repository}`);
}
