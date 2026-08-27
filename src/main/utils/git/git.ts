import type { MirrorSource } from '../../../shared/domain/mirror';
import type { MofoxCommit, MofoxCurrentCommit } from '../../../shared/domain/update';
import { MofoxError } from '../../../shared/domain/error';
import { execCommand } from '../platform-helper';
import { githubMirrorsOf, resolveGithubUrl } from './github-mirror';

// Neo-MoFox 本体仓库；分支与提交回退均作用于该仓库的本地克隆。
const MOFOX_REPOSITORY = 'MoFox-Studio/Neo-MoFox';
/** 浅克隆保留的提交历史深度，供版本管理页回退历史提交使用。 */
const GIT_DEPTH = 20;

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
      const result = await execCommand(
        'git',
        ['clone', '--depth', String(GIT_DEPTH), '-b', branch, '--single-branch', url, destination],
        {
          timeoutMs: 600_000,
          ...(signal ? { signal } : {}),
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

/**
 * 判断目录是否为有效的 Git 仓库。
 *
 * @param directory - 待检查的目录绝对路径。
 * @returns 目录中存在 `.git` 且 git 可识别时返回 `true`。
 */
export async function isGitRepository(directory: string): Promise<boolean> {
  const result = await execCommand('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: directory,
    timeoutMs: 15_000,
  });
  return result.exitCode === 0;
}

/**
 * 获取当前检出分支名。
 *
 * @param directory - 仓库目录绝对路径。
 * @returns 当前分支名；读取失败时返回 `null`。
 */
export async function getCurrentBranch(directory: string): Promise<string | null> {
  if (!(await isGitRepository(directory))) return null;
  const result = await execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: directory,
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0) return null;
  return result.stdout.trim();
}

/**
 * 获取当前 HEAD 的提交摘要（短哈希、消息与时间）。
 *
 * @param directory - 仓库目录绝对路径。
 * @returns 当前提交摘要；读取失败时返回 `null`。
 */
export async function getCurrentCommit(directory: string): Promise<MofoxCurrentCommit | null> {
  if (!(await isGitRepository(directory))) return null;
  const result = await execCommand('git', ['log', '-1', '--format=%h|||%s|||%ci'], {
    cwd: directory,
    timeoutMs: 15_000,
  });
  if (result.exitCode !== 0) return null;
  const [hash, message, date] = parseDelimited(result.stdout, 3);
  return { hash, message, date };
}

/**
 * 获取本地提交历史列表（最新在前）。
 *
 * @param directory - 仓库目录绝对路径。
 * @param limit - 返回条数，默认 20。
 * @returns 包含短哈希、完整哈希、消息、时间与当前标记的提交数组。
 */
export async function getCommitList(directory: string, limit = 20): Promise<MofoxCommit[]> {
  if (!(await isGitRepository(directory))) return [];
  const current = await getCurrentCommit(directory);
  const result = await execCommand('git', ['log', `--format=%H|||%s|||%ci`, '-n', String(limit)], {
    cwd: directory,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [fullHash, message, date] = parseDelimited(line, 3);
      const hash = fullHash.slice(0, 7);
      return { hash, fullHash, message, date, isCurrent: hash === current?.hash };
    });
}

/**
 * 检查本地仓库相对远程跟踪分支的更新情况。
 *
 * 先 `git fetch` 刷新远程引用，再以 `rev-list --left-right --count` 统计
 * 本地与远程的领先/落后提交数。
 *
 * @param directory - 仓库目录绝对路径。
 * @returns 包含是否可更新与领先/落后数量的对象；仓库无效时返回全零状态。
 */
export async function checkUpdateStatus(
  directory: string,
): Promise<{ hasUpdate: boolean; behindCount: number; aheadCount: number }> {
  if (!(await isGitRepository(directory))) {
    return { hasUpdate: false, behindCount: 0, aheadCount: 0 };
  }
  const branch = await getCurrentBranch(directory);
  if (!branch) return { hasUpdate: false, behindCount: 0, aheadCount: 0 };
  await execCommand('git', ['fetch', 'origin'], {
    cwd: directory,
    timeoutMs: 120_000,
  }).catch(() => undefined);
  const result = await execCommand(
    'git',
    ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`],
    { cwd: directory, timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) return { hasUpdate: false, behindCount: 0, aheadCount: 0 };
  const [aheadText = '0', behindText = '0'] = result.stdout.trim().split(/\s+/);
  const aheadCount = parseInt(aheadText, 10) || 0;
  const behindCount = parseInt(behindText, 10) || 0;
  return { hasUpdate: behindCount > 0, behindCount, aheadCount };
}

/**
 * 切换分支到指定远程分支并拉取最新代码。
 *
 * 先 fetch 指定远程分支，若有未提交更改则暂存，再 checkout 并 pull；
 * 完成后同步 Python 依赖（uv sync）。
 *
 * @param directory - 仓库目录绝对路径。
 * @param branch - 目标分支名。
 * @param onProgress - 可选的阶段进度回调。
 * @throws {MofoxError} 仓库无效、切换失败或目标分支不存在时抛出。
 */
export async function switchBranch(
  directory: string,
  branch: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  if (!(await isGitRepository(directory))) {
    throw new MofoxError('INVALID_ARGUMENT', '安装目录不是有效的 Git 仓库');
  }
  await runGit(directory, ['fetch', 'origin', branch], 120_000, onProgress, '正在获取远程分支...');
  await stashIfDirty(directory, onProgress);
  onProgress?.('正在切换分支...');
  await runGit(directory, ['checkout', branch], 60_000);
  await runGit(directory, ['pull', 'origin', branch], 600_000, onProgress, '正在拉取最新代码...');
  await syncDependencies(directory, onProgress);
}

/**
 * 回退（检出）到指定提交。
 *
 * 若有未提交更改则暂存，然后 checkout 到目标提交并同步 Python 依赖。
 *
 * @param directory - 仓库目录绝对路径。
 * @param commitHash - 目标提交的短哈希或完整哈希。
 * @param onProgress - 可选的阶段进度回调。
 * @throws {MofoxError} 仓库无效或检出失败时抛出。
 */
export async function checkoutCommit(
  directory: string,
  commitHash: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  if (!(await isGitRepository(directory))) {
    throw new MofoxError('INVALID_ARGUMENT', '安装目录不是有效的 Git 仓库');
  }
  if (!commitHash.trim()) throw new MofoxError('INVALID_ARGUMENT', '提交号不能为空');
  await stashIfDirty(directory, onProgress);
  onProgress?.(`正在切换到提交 ${commitHash}...`);
  await runGit(directory, ['checkout', commitHash], 60_000);
  await syncDependencies(directory, onProgress);
}

/**
 * 更新主程序到当前分支的最新提交。
 *
 * 若有未提交更改则暂存，拉取当前分支最新代码并同步 Python 依赖。
 *
 * @param directory - 仓库目录绝对路径。
 * @param onProgress - 可选的阶段进度回调。
 * @throws {MofoxError} 仓库无效或拉取失败时抛出。
 */
export async function updateToLatest(
  directory: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  if (!(await isGitRepository(directory))) {
    throw new MofoxError('INVALID_ARGUMENT', '安装目录不是有效的 Git 仓库');
  }
  const branch = await getCurrentBranch(directory);
  if (!branch) throw new MofoxError('INVALID_ARGUMENT', '无法识别当前分支');
  await stashIfDirty(directory, onProgress);
  onProgress?.('正在拉取最新代码...');
  await runGit(directory, ['pull', 'origin', branch], 600_000);
  await syncDependencies(directory, onProgress);
}

/**
 * 获取 Neo-MoFox 仓库的远程分支列表。
 *
 * 通过 GitHub API 按镜像顺序轮询，首个成功即采用。
 *
 * @param mirrors - 全部镜像源，内部只消费 `github` 类型。
 * @param signal - 可选的取消信号。
 * @returns 远程分支名数组；全部镜像失败时返回空数组。
 */
export async function fetchRemoteBranches(
  mirrors: readonly MirrorSource[],
  signal?: AbortSignal,
): Promise<string[]> {
  const apiBranches = await fetchApiBranches(mirrors, signal);
  if (apiBranches.length > 0) return apiBranches;
  // GitHub API 不可用（限流/被墙）时回退到 git ls-remote，走 git 协议。
  return fetchBranchesViaGit(mirrors);
}

/**
 * 通过 GitHub API 获取远程分支列表，按镜像顺序轮询。
 *
 * @param mirrors - 全部镜像源，内部只消费 `github` 类型。
 * @param signal - 可选的取消信号。
 * @returns 远程分支名数组；全部失败或为空时返回 `[]`。
 */
async function fetchApiBranches(
  mirrors: readonly MirrorSource[],
  signal?: AbortSignal,
): Promise<string[]> {
  const sources = githubMirrorsOf(mirrors);
  if (sources.length === 0) return [];
  for (const mirror of sources) {
    try {
      const url = resolveGithubUrl(
        mirror,
        `https://api.github.com/repos/${MOFOX_REPOSITORY}/branches?per_page=100`,
      );
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo-MoFox-Launcher' },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new MofoxError('IO_ERROR', `HTTP ${response.status}`);
      const data = (await response.json()) as Array<{ name?: string }>;
      const branches = data.map((entry) => entry.name ?? '').filter(Boolean);
      if (branches.length > 0) return branches;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return [];
}

/**
 * 通过 `git ls-remote` 读取远程分支，作为 GitHub API 不可用时的回退。
 *
 * 按镜像顺序尝试，解析 `refs/heads/<branch>` 输出为分支名。
 *
 * @param mirrors - 全部镜像源，内部只消费 `github` 类型。
 * @returns 远程分支名数组；全部失败时返回 `[]`。
 */
async function fetchBranchesViaGit(mirrors: readonly MirrorSource[]): Promise<string[]> {
  const sources = githubMirrorsOf(mirrors);
  const original = `https://github.com/${MOFOX_REPOSITORY}.git`;
  for (const mirror of sources) {
    const url = resolveGithubUrl(mirror, original);
    const result = await execCommand('git', ['ls-remote', '--heads', url], {
      timeoutMs: 60_000,
    }).catch(() => undefined);
    if (!result || result.exitCode !== 0) continue;
    const branches = result.stdout
      .split(/\r?\n/)
      .map((line) => line.match(/refs\/heads\/(.+)$/)?.[1])
      .filter((branch): branch is string => Boolean(branch));
    if (branches.length > 0) return branches;
  }
  return [];
}

/**
 * 在仓库目录内执行 git 命令；非零退出码时抛出可读错误。
 *
 * @param directory - 仓库目录绝对路径。
 * @param args - git 参数列表。
 * @param timeoutMs - 超时毫秒数。
 * @param onProgress - 可选的阶段进度回调。
 * @param progressMessage - 调用 onProgress 时附带的消息。
 * @throws {MofoxError} git 命令失败时抛出 `IO_ERROR`。
 */
async function runGit(
  directory: string,
  args: string[],
  timeoutMs: number,
  onProgress?: (message: string) => void,
  progressMessage?: string,
): Promise<void> {
  if (progressMessage) onProgress?.(progressMessage);
  const result = await execCommand('git', args, { cwd: directory, timeoutMs });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', result.stderr?.trim() || `git ${args[0]} 失败`);
  }
}

/**
 * 若有未提交更改则执行 `git stash` 暂存。
 *
 * @param directory - 仓库目录绝对路径。
 * @param onProgress - 可选的阶段进度回调。
 */
async function stashIfDirty(
  directory: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const status = await execCommand('git', ['status', '--porcelain'], {
    cwd: directory,
    timeoutMs: 15_000,
  });
  if (status.exitCode !== 0 || !status.stdout.trim()) return;
  onProgress?.('暂存本地更改...');
  await runGit(directory, ['stash'], 30_000);
}

/**
 * 执行 `uv sync` 同步 Python 依赖；失败仅记录进度而不中断流程。
 *
 * @param directory - 仓库目录绝对路径。
 * @param onProgress - 可选的阶段进度回调。
 */
async function syncDependencies(
  directory: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  onProgress?.('正在同步依赖 (uv sync)...');
  const result = await execCommand('uv', ['sync'], {
    cwd: directory,
    timeoutMs: 600_000,
  });
  if (result.exitCode !== 0) {
    onProgress?.('依赖同步失败，可稍后手动执行 uv sync');
  }
}

/**
 * 解析 `|||` 分隔的 git 输出行；字段缺失时以空字符串补齐。
 *
 * @param value - 原始输出行。
 * @param count - 期望的字段数量。
 * @returns 解析后的字段数组。
 */
function parseDelimited(value: string, count: number): string[] {
  const parts = value.split('|||');
  return Array.from({ length: count }, (_, index) => (parts[index] ?? '').trim());
}
