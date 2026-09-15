import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { InstallContext, InstallResult } from '../../../shared/domain/bot-platform';
import type { MirrorSource } from '../../../shared/domain/mirror';
import type { GithubRelease, GithubReleaseAsset } from '../../../shared/domain/github';
import { MofoxError } from '../../../shared/domain/error';
import { downloadRange } from '../range-downloader';
import { resolveGithubUrl, tryEachGithubMirror } from './github-mirror';
import { describeNetworkError } from '../network-error';
import { extractZipSecurely } from '../zip-extractor';
import { extractTarGzSecurely } from '../tar-extractor';

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

  // 两种归档均由受限的进程内解压器处理，拒绝路径穿越、链接、特殊文件与压缩炸弹。
  if (asset.name.endsWith('.zip')) await extractZipSecurely(archive, payload);
  else if (asset.name.endsWith('.tar.gz')) {
    await extractTarGzSecurely(archive, payload, context.signal ? { signal: context.signal } : {});
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
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new MofoxError('INVALID_ARGUMENT', 'Release 查询数量必须在 1-100 之间');
  }
  return tryEachGithubMirror(
    mirrors,
    signal,
    async (mirror) => {
      const url = resolveGithubUrl(
        mirror,
        `https://api.github.com/repos/${repository}/releases?per_page=${limit}`,
      );
      const response = await githubFetch('GitHub releases 请求失败', url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo-MoFox-Launcher' },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new MofoxError(
          'IO_ERROR',
          `GitHub releases 请求失败: HTTP ${response.status}（${describeNetworkError(response.status)}）`,
        );
      return parseReleaseList(await response.json());
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
      const response = await githubFetch('GitHub release 请求失败', url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo-MoFox-Launcher' },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new MofoxError(
          'IO_ERROR',
          `GitHub release 请求失败: HTTP ${response.status}（${describeNetworkError(response.status)}）`,
        );
      return parseRelease(await response.json());
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
  const expectedDigest = requireSha256Digest(asset);
  const assetUrl = requireHttpsUrl(asset.browser_download_url, '发行版下载地址');
  return tryEachGithubMirror(
    mirrors,
    signal,
    async (mirror) => {
      const url = resolveGithubUrl(mirror, assetUrl);
      const allowedRedirectHosts = [
        new URL(assetUrl).hostname,
        'github.com',
        'objects.githubusercontent.com',
        'release-assets.githubusercontent.com',
      ];
      await downloadRange(url, destination, {
        ...(signal ? { signal } : {}),
        maxBytes: 4 * 1024 ** 3,
        allowedRedirectHosts,
      });
      const actual = await sha256(destination);
      if (actual !== expectedDigest) {
        await rm(destination, { force: true }).catch(() => undefined);
        throw new MofoxError('IO_ERROR', `${asset.name} SHA-256 校验失败`);
      }
    },
    `所有镜像均无法下载 ${asset.name}`,
  );
}

/**
 * 发起 GitHub 相关请求并将网络层错误（证书、DNS、连接等）转换为可读描述。
 *
 * 取消信号触发时原样上抛，避免把用户主动取消误报为网络故障。
 *
 * @param label - 失败时附带的操作描述前缀。
 * @param input - 请求地址。
 * @param init - 请求选项。
 * @returns fetch 响应；仅在网络层失败时抛出 `IO_ERROR`。
 */
async function githubFetch(
  label: string,
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  let current = requireHttpsUrl(String(input), 'GitHub 请求地址');
  const initialHost = new URL(current).hostname.toLowerCase();
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(current, { ...init, redirect: 'manual' });
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      throw new MofoxError('IO_ERROR', `${label}: ${describeNetworkError(error)}`);
    }
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location || redirects === 5) {
      throw new MofoxError('IO_ERROR', `${label}: 重定向无效或次数过多`);
    }
    const next = new URL(location, current);
    const hostname = next.hostname.toLowerCase();
    if (
      hostname !== initialHost &&
      hostname !== 'github.com' &&
      hostname !== 'api.github.com' &&
      hostname !== 'raw.githubusercontent.com' &&
      hostname !== 'objects.githubusercontent.com' &&
      hostname !== 'release-assets.githubusercontent.com' &&
      !hostname.endsWith('.githubusercontent.com')
    ) {
      throw new MofoxError('IO_ERROR', `${label}: 拒绝跳转到未授权主机 ${hostname}`);
    }
    current = requireHttpsUrl(next.toString(), 'GitHub 重定向地址');
  }
  throw new MofoxError('IO_ERROR', `${label}: 重定向次数过多`);
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
      const response = await githubFetch(`拉取 ${path} 失败`, url, {
        headers: { 'User-Agent': 'Neo-MoFox-Launcher' },
        ...(signal ? { signal } : {}),
      });
      if (!response.ok)
        throw new MofoxError(
          'IO_ERROR',
          `拉取 ${path} 失败: HTTP ${response.status}（${describeNetworkError(response.status)}）`,
        );
      const declaredSize = Number(response.headers.get('content-length') ?? 0);
      if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > 2 * 1024 ** 2) {
        throw new MofoxError('IO_ERROR', `${path} 的响应大小无效或超过 2 MiB`);
      }
      const content = await response.text();
      if (Buffer.byteLength(content, 'utf8') > 2 * 1024 ** 2) {
        throw new MofoxError('IO_ERROR', `${path} 的正文超过 2 MiB`);
      }
      return { source: mirror.name, content };
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

function requireSha256Digest(asset: ReleaseAsset): string {
  if (!asset.digest || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) {
    throw new MofoxError('UNAVAILABLE', `${asset.name} 未提供可验证的 SHA-256 摘要`);
  }
  return asset.digest.slice(7).toLowerCase();
}

function parseReleaseList(value: unknown): Release[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new MofoxError('IO_ERROR', 'GitHub Release 列表结构无效');
  }
  return value.map(parseRelease);
}

function parseRelease(value: unknown): Release {
  if (!isRecord(value) || typeof value.tag_name !== 'string' || !value.tag_name.trim()) {
    throw new MofoxError('IO_ERROR', 'GitHub Release 元数据缺少有效版本号');
  }
  if (
    (value.name !== null && typeof value.name !== 'string') ||
    (value.body !== null && typeof value.body !== 'string') ||
    (value.published_at !== null && typeof value.published_at !== 'string') ||
    typeof value.prerelease !== 'boolean' ||
    !Array.isArray(value.assets) ||
    value.assets.length > 1_000
  ) {
    throw new MofoxError('IO_ERROR', 'GitHub Release 元数据结构无效');
  }
  const assets = value.assets.map((asset): ReleaseAsset => {
    if (
      !isRecord(asset) ||
      typeof asset.name !== 'string' ||
      !asset.name ||
      asset.name !== basename(asset.name) ||
      typeof asset.browser_download_url !== 'string'
    ) {
      throw new MofoxError('IO_ERROR', 'GitHub Release 资产元数据无效');
    }
    const browserDownloadUrl = requireHttpsUrl(asset.browser_download_url, '发行版下载地址');
    if (asset.digest !== undefined && asset.digest !== null && typeof asset.digest !== 'string') {
      throw new MofoxError('IO_ERROR', 'GitHub Release 资产摘要格式无效');
    }
    return {
      name: asset.name,
      browser_download_url: browserDownloadUrl,
      ...(typeof asset.digest === 'string' ? { digest: asset.digest } : {}),
    };
  });
  return {
    tag_name: value.tag_name,
    name: value.name,
    body: value.body,
    published_at: value.published_at,
    prerelease: value.prerelease,
    assets,
  };
}

function requireHttpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MofoxError('IO_ERROR', `${label}无效`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new MofoxError('IO_ERROR', `${label}必须使用无凭据的 HTTPS`);
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
