import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import extractZip from 'extract-zip';
import type { InstallContext, InstallResult } from '../../../shared/domain/bot-platform';
import type { MirrorSource } from '../../../shared/domain/mirror';
import type { GithubRelease, GithubReleaseAsset } from '../../../shared/domain/github';
import { MofoxError } from '../../../shared/domain/error';
import { downloadRange } from '../range-downloader';
import { runOneShot } from '../process-helper';
import { resolveGithubUrl, tryEachGithubMirror } from './github-mirror';
import { describeHttpStatus } from '../http-status';

// GitHub Release 下载与查询的镜像轮询实现，供平台安装/更新与版本列表复用。

/** GitHub Release 资产；`digest` 仅在发布元数据提供 SHA-256 时存在。 */
export type Release = GithubRelease;
export type ReleaseAsset = GithubReleaseAsset;

/**
 * 通过 GitHub Release 资产完成平台安装。
 *
 * 流水线依次执行：发行版查询、资产选择、分镜下载、可选 SHA-256 校验、
 * ZIP/tar.gz 解压与根目录确认；每一步均按 `github` 类镜像顺序轮询。
 *
 * `context.version` 为 `latest` 时拉取最新发行版，否则拉取对应 tag 的发行版，
 * 供版本切换/回退复用同一套下载解压逻辑。
 *
 * @param context - 安装上下文（工作目录、目标目录、版本、镜像源、取消信号等）。
 * @param mirrors - 全部镜像源，函数内部只使用 `github` 类型。
 * @param repository - GitHub 仓库的 `owner/repo` 字符串。
 * @param selectAsset - 在发行版资产列表中选择当前系统适用资产的回调。
 * @param isRoot - 判断候选目录是否符合平台安装根定义的回调。
 * @returns 包含版本号与最终安装路径的安装结果。
 */
export async function installGithubRelease(
  context: InstallContext,
  mirrors: readonly MirrorSource[],
  repository: string,
  selectAsset: (release: Release) => ReleaseAsset | undefined,
  isRoot: (path: string) => Promise<boolean>,
): Promise<InstallResult> {
  const release = await fetchRelease(
    mirrors,
    repository,
    context.version ?? 'latest',
    context.signal,
  );
  const asset = selectAsset(release);
  if (!asset)
    throw new MofoxError('UNAVAILABLE', `发行版 ${release.tag_name} 没有适合当前系统的完整包`);

  const archive = join(context.workDir, basename(asset.name));
  const payload = join(context.workDir, 'payload');
  await mkdir(payload, { recursive: true });
  await downloadAsset(mirrors, asset, archive, context.signal);
  if (asset.digest?.startsWith('sha256:')) {
    // 仅在发布元数据提供 SHA-256 时校验，失败时不允许进入解压阶段。
    const actual = await sha256(archive);
    if (actual !== asset.digest.slice(7).toLowerCase()) {
      throw new MofoxError('IO_ERROR', `${asset.name} SHA-256 校验失败`);
    }
  }

  // ZIP 由库在当前进程解压，tar.gz 交给系统 tar 并限制外部进程最长执行时间。
  if (asset.name.endsWith('.zip')) await extractZip(archive, { dir: payload });
  else if (asset.name.endsWith('.tar.gz')) {
    const result = await runOneShot('tar', ['-xzf', archive, '-C', payload], {
      timeoutMs: 120_000,
    });
    if (result.exitCode !== 0) throw new MofoxError('IO_ERROR', `解压失败: ${result.stderr}`);
  } else throw new MofoxError('UNAVAILABLE', `不支持的压缩包格式: ${asset.name}`);
  await rm(archive, { force: true });

  // Release 可能直接解出根目录，也可能额外包一层顶级目录，逐一交由平台规则确认。
  for (const candidate of [
    payload,
    ...(await childDirectories(payload)).map((name) => join(payload, name)),
  ]) {
    if (await isRoot(candidate)) return { version: release.tag_name, installPath: candidate };
  }
  throw new MofoxError('IO_ERROR', `${asset.name} 解压后的目录结构无效`);
}

/**
 * 仅下载指定仓库发行版中的某个资产，不执行解压。
 *
 * 供需要保留原始文件（如 `.mfp` 插件包）的场景复用同一套镜像轮询逻辑。
 *
 * @param options - 镜像、仓库、资产选择回调、目标路径与取消信号。
 * @returns 命中的资产名与发行版版本号。
 */
export async function downloadReleaseAsset(options: {
  mirrors: readonly MirrorSource[];
  repository: string;
  selectAsset: (release: Release) => ReleaseAsset | undefined;
  destination: string;
  signal?: AbortSignal;
}): Promise<{ assetName: string; version: string }> {
  const { mirrors, repository, selectAsset, destination, signal } = options;
  const release = await fetchRelease(mirrors, repository, 'latest', signal);
  const asset = selectAsset(release);
  if (!asset) throw new MofoxError('UNAVAILABLE', `发行版 ${release.tag_name} 没有匹配的资产`);
  await downloadAsset(mirrors, asset, destination, signal);
  return { assetName: asset.name, version: release.tag_name };
}

/**
 * 获取指定仓库的 Release 列表（含预发布与旧版本），供版本选择界面使用。
 *
 * @param mirrors - 仅消费 `github` 类型的镜像列表。
 * @param repository - GitHub 仓库的 `owner/repo` 字符串。
 * @param signal - 可选的取消信号；触发后立即抛出当前错误。
 * @param limit - 返回的最大条数，默认 20。
 * @returns 按发布时间倒序的 Release 列表。
 * @throws {MofoxError} 镜像列表为空或所有镜像均失败时抛出最后一个错误。
 */
export async function fetchReleases(
  mirrors: readonly MirrorSource[],
  repository: string,
  signal?: AbortSignal,
  limit = 20,
): Promise<Release[]> {
  return tryEachGithubMirror(
    mirrors,
    signal,
    async (mirror) => {
      const url = resolveGithubUrl(
        mirror,
        `https://api.github.com/repos/${repository}/releases?per_page=${limit}`,
      );
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo-MoFox-Launcher' },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new MofoxError(
          'IO_ERROR',
          `GitHub releases 请求失败: HTTP ${response.status}（${describeHttpStatus(response.status)}）`,
        );
      return (await response.json()) as Release[];
    },
    `所有镜像均无法获取 ${repository} 发行版列表`,
  );
}

/**
 * 顺序尝试每个镜像获取 GitHub 发行版元数据，首个成功即采用。
 *
 * @param mirrors - 仅消费 `github` 类型的镜像列表。
 * @param repository - GitHub 仓库的 `owner/repo` 字符串。
 * @param version - `latest` 表示最新发行版，其余值按 tag 拉取对应发行版。
 * @param signal - 可选的取消信号；触发后立即抛出当前错误。
 * @returns 解析后的 GitHub Release 元数据。
 * @throws {MofoxError} 镜像列表为空或所有镜像均失败时抛出最后一个错误。
 */
async function fetchRelease(
  mirrors: readonly MirrorSource[],
  repository: string,
  version: string,
  signal?: AbortSignal,
): Promise<Release> {
  return tryEachGithubMirror(
    mirrors,
    signal,
    async (mirror) => {
      const endpoint =
        version === 'latest' ? `releases/latest` : `releases/tags/${encodeURIComponent(version)}`;
      const url = resolveGithubUrl(
        mirror,
        `https://api.github.com/repos/${repository}/${endpoint}`,
      );
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo-MoFox-Launcher' },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new MofoxError(
          'IO_ERROR',
          `GitHub release 请求失败: HTTP ${response.status}（${describeHttpStatus(response.status)}）`,
        );
      return (await response.json()) as Release;
    },
    `所有镜像均无法获取 ${repository} 发行版信息`,
  );
}

/**
 * 顺序尝试每个镜像下载指定资产，首个成功即采用。
 *
 * @param mirrors - 仅消费 `github` 类型的镜像列表。
 * @param asset - 待下载的发行版资产。
 * @param destination - 本地目标文件路径。
 * @param signal - 可选的取消信号；触发后立即抛出当前错误。
 * @throws {MofoxError} 镜像列表为空或所有镜像均失败时抛出最后一个错误。
 */
async function downloadAsset(
  mirrors: readonly MirrorSource[],
  asset: ReleaseAsset,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  return tryEachGithubMirror(
    mirrors,
    signal,
    async (mirror) => {
      const url = resolveGithubUrl(mirror, asset.browser_download_url);
      await downloadRange(url, destination, signal ? { signal } : {});
    },
    `所有镜像均无法下载 ${asset.name}`,
  );
}

/**
 * 拉取指定仓库中指定分支下的单个文件内容。
 *
 * 供许可协议等只读文本的展示使用；按 `raw.githubusercontent.com` 原始地址镜像轮询。
 *
 * @param options - 镜像、仓库、文件路径、分支与取消信号。
 * @returns 命中的镜像源名称与文件内容。
 */
export async function fetchRepositoryFile(options: {
  mirrors: readonly MirrorSource[];
  repository: string;
  path: string;
  branch?: string;
  signal?: AbortSignal;
}): Promise<{ source: string; content: string }> {
  const { mirrors, repository, path, branch = 'main', signal } = options;
  return tryEachGithubMirror(
    mirrors,
    signal,
    async (mirror) => {
      const original = `https://raw.githubusercontent.com/${repository}/${branch}/${path}`;
      const url = resolveGithubUrl(mirror, original);
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Neo-MoFox-Launcher' },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new MofoxError(
          'IO_ERROR',
          `拉取 ${path} 失败: HTTP ${response.status}（${describeHttpStatus(response.status)}）`,
        );
      return { source: mirror.name, content: await response.text() };
    },
    `所有镜像均无法获取 ${repository}/${path}`,
  );
}

/**
 * 并发检查目录下是否全部存在指定文件。
 *
 * @param root - 待检查的目录路径。
 * @param names - 必须存在的文件名列表。
 * @returns 所有文件均可访问时返回 `true`，任一缺失则返回 `false`。
 */
export async function hasFiles(root: string, names: string[]): Promise<boolean> {
  return (
    await Promise.all(
      names.map((name) =>
        access(join(root, name)).then(
          () => true,
          () => false,
        ),
      ),
    )
  ).every(Boolean);
}

/**
 * 列出指定目录下的子项名称；读取失败时返回空数组而非抛出。
 *
 * @param path - 待枚举的目录路径。
 * @returns 子项名称数组；目录不存在或不可读时为 `[]`。
 */
async function childDirectories(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/**
 * 流式计算文件的 SHA-256 摘要。
 *
 * @param path - 待校验的文件路径。
 * @returns 文件内容的十六进制 SHA-256 字符串。
 */
async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
