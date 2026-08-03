import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import extractZip from 'extract-zip';
import type { InstallContext, InstallResult } from '../../shared/domain/bot-platform';
import type { MirrorSource } from '../../shared/domain/mirror';
import { MofoxError } from '../../shared/domain/error';
import { downloadRange } from '../utils/range-downloader';
import { runOneShot } from '../utils/process-service';

// GitHub Release 安装流水线的最小元数据结构，仅保留选择资产与校验所需字段。
interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string;
}
interface Release {
  tag_name: string;
  assets: ReleaseAsset[];
}

/**
 * 通过 GitHub Release 资产完成平台安装。
 *
 * 流水线依次执行：发行版查询、资产选择、分镜下载、可选 SHA-256 校验、
 * ZIP/tar.gz 解压与根目录确认；每一步均按 `github` 类镜像顺序轮询。
 *
 * @param context - 安装上下文（工作目录、目标目录、镜像源、取消信号等）。
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
  // 发行版查询、资产选择、下载校验、解压和根目录确认依次完成；各镜像在每一步按序轮询。
  // GitHub 流水线只消费 github 类镜像，python-ftp 类镜像留给后续依赖安装阶段使用。
  const githubMirrors = mirrors.filter((mirror) => mirror.type === 'github');
  const release = await fetchRelease(githubMirrors, repository, context.signal);
  const asset = selectAsset(release);
  if (!asset)
    throw new MofoxError('UNAVAILABLE', `发行版 ${release.tag_name} 没有适合当前系统的完整包`);

  const archive = join(context.workDir, basename(asset.name));
  const payload = join(context.workDir, 'payload');
  await mkdir(payload, { recursive: true });
  await downloadAsset(githubMirrors, asset, archive, context.signal);
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
 * 顺序尝试每个镜像获取 GitHub 发行版元数据，首个成功即采用。
 *
 * @param mirrors - 仅消费 `github` 类型的镜像列表。
 * @param repository - GitHub 仓库的 `owner/repo` 字符串。
 * @param signal - 可选的取消信号；触发后立即抛出当前错误。
 * @returns 解析后的 GitHub Release 元数据。
 * @throws {MofoxError} 镜像列表为空或所有镜像均失败时抛出最后一个错误。
 */
async function fetchRelease(
  mirrors: readonly MirrorSource[],
  repository: string,
  signal?: AbortSignal,
): Promise<Release> {
  if (mirrors.length === 0) throw new MofoxError('UNAVAILABLE', '未配置任何镜像源');
  let lastError: unknown;
  for (const mirror of mirrors) {
    try {
      const url = resolveProxiedUrl(
        mirror,
        `https://api.github.com/repos/${repository}/releases/latest`,
      );
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo-MoFox-Launcher' },
        signal,
      });
      if (!response.ok)
        throw new MofoxError('IO_ERROR', `GitHub release 请求失败: HTTP ${response.status}`);
      return (await response.json()) as Release;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new MofoxError('UNAVAILABLE', `所有镜像均无法获取 ${repository} 发行版信息`);
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
  if (mirrors.length === 0) throw new MofoxError('UNAVAILABLE', '未配置任何镜像源');
  let lastError: unknown;
  for (const mirror of mirrors) {
    try {
      const url = resolveProxiedUrl(mirror, asset.browser_download_url);
      await downloadRange(url, destination, signal ? { signal } : {});
      return;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new MofoxError('IO_ERROR', `所有镜像均无法下载 ${asset.name}`);
}

/**
 * 根据镜像类型解析实际下载地址。
 *
 * 直连镜像使用原始地址；代理镜像以 `${baseUrl}/${originalUrl}` 形式包装。
 *
 * @param mirror - 当前镜像源。
 * @param originalUrl - GitHub 原始地址。
 * @returns 用于发起请求的最终 URL。
 */
function resolveProxiedUrl(mirror: MirrorSource, originalUrl: string): string {
  if (mirror.baseUrl === 'https://github.com') return originalUrl;
  return `${mirror.baseUrl}/${originalUrl}`;
}

/**
 * 并发检查目录下是否全部存在指定文件。
 *
 * @param root - 待检查的目录路径。
 * @param names - 必须存在的文件名列表。
 * @returns 所有文件均可访问时返回 `true`，任一缺失则返回 `false`。
 */
export async function hasFiles(root: string, names: string[]): Promise<boolean> {
  // 必需文件的访问检查可并发进行，任一缺失即视为该目录不符合安装根定义。
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
 * 通过 `createReadStream` 分块读取，避免大体积 Release 完整载入主进程内存。
 *
 * @param path - 待校验的文件路径。
 * @returns 文件内容的十六进制 SHA-256 字符串。
 */
async function sha256(path: string): Promise<string> {
  // 流式读取归档，避免大体积 Release 完整载入主进程内存。
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
