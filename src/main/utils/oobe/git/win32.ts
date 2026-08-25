import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MofoxError } from '../../../../shared/domain/error';
import { downloadRange } from '../../range-downloader';
import { runOneShot } from '../../process-helper';
import type { DependencyInstallContext } from '../types';

// Git for Windows 静默安装参数：禁用 UI、不重启、注册 LFS / 关联 / Shell 组件。
const GIT_SILENT_ARGS = [
  '/VERYSILENT',
  '/NORESTART',
  '/CLOSEAPPLICATIONS',
  '/RESTARTAPPLICATIONS',
  '/COMPONENTS="gitlfs,assoc,assoc_sh"',
];

/** winget 调用参数：固定 ID、统一接收协议、静默安装。 */
const WINGET_ARGS = [
  'install',
  '--id',
  'Git.Git',
  '-e',
  '--source',
  'winget',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--silent',
];

/**
 * 在 Windows 上安装 Git：优先 winget，失败回退到下载 Git for Windows 安装包静默执行。
 *
 * 两条路径均不向用户暴露原生安装 UI；winget 不可用或返回非零退出码时才进入下载分支，
 * 下载使用 GitHub 镜像按序轮询，安装包在执行完毕后回收。
 *
 * @param context - 安装上下文（工作目录、进度回调、镜像源、取消信号）。
 * @returns 安装完成后的版本字符串（取自发行版 tag）。
 */
export async function installGitWin32(context: DependencyInstallContext): Promise<string> {
  try {
    await runWinget(context);
    context.onProgress?.('winget 已安装 Git');
    return 'winget';
  } catch (error) {
    context.onProgress?.(
      `winget 不可用或失败，回退到下载安装包: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return downloadAndInstall(context);
}

/**
 * 调用 winget 完成安装；非零退出码或超时均视为失败以便回退。
 */
async function runWinget(context: DependencyInstallContext): Promise<void> {
  context.onProgress?.('通过 winget 安装 Git...', 0.1);
  const result = await runOneShot('winget', WINGET_ARGS, {
    timeoutMs: 600_000,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `winget 安装失败: ${result.stderr || result.stdout}`);
  }
}

/**
 * 下载 Git for Windows 安装包并静默执行；安装包在执行完成后回收。
 *
 * 镜像按 `github` 类型顺序轮询，首个成功即采用；下载失败或解压校验失败时抛出。
 */
async function downloadAndInstall(context: DependencyInstallContext): Promise<string> {
  context.onProgress?.('正在查询 Git for Windows 最新发行版...', 0.2);
  const { asset, version } = await resolveGitRelease(context);
  const installerPath = join(context.workDir, asset.name);
  context.onProgress?.(`正在下载 ${asset.name}...`, 0.3);
  await downloadAsset(asset.url, installerPath, context);

  context.onProgress?.(`正在静默安装 ${asset.name}...`, 0.8);
  const result = await runOneShot(installerPath, GIT_SILENT_ARGS, {
    timeoutMs: 600_000,
    windowsHide: true,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  await rm(installerPath, { force: true });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `Git 安装包执行失败: ${result.stderr || result.stdout}`);
  }
  return version;
}

interface GitReleaseAsset {
  name: string;
  url: string;
}

interface GitRelease {
  version: string;
  asset: GitReleaseAsset;
}

/**
 * 调用 GitHub API 解析当前架构对应的 Git for Windows 安装包。
 *
 * 仅选择 `*-64-bit.exe`（arm64 暂未提供官方 Git for Windows 安装器）。
 *
 * @param context - 安装上下文，使用其 `mirrors` 字段轮询 GitHub 镜像。
 * @returns 包含版本号与下载地址的资产描述。
 */
async function resolveGitRelease(context: DependencyInstallContext): Promise<GitRelease> {
  const mirrors = context.mirrors?.filter((m) => m.type === 'github') ?? [];
  const baseUrls =
    mirrors.length > 0
      ? mirrors.map((m) => resolveProxiedUrl(m, 'https://api.github.com/repos/git-for-windows/git/releases/latest'))
      : ['https://api.github.com/repos/git-for-windows/git/releases/latest'];
  let lastError: unknown;
  for (const url of baseUrls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo-MoFox-Launcher' },
        ...(context.signal ? { signal: context.signal } : {}),
      });
      if (!response.ok) throw new MofoxError('IO_ERROR', `GitHub release 请求失败: HTTP ${response.status}`);
      const release = (await response.json()) as {
        tag_name: string;
        assets: Array<{ name: string; browser_download_url: string }>;
      };
      const asset = release.assets.find((candidate) => candidate.name.endsWith('-64-bit.exe'));
      if (!asset) throw new MofoxError('UNAVAILABLE', '未找到 Git for Windows 64-bit 安装包');
      return {
        version: release.tag_name,
        asset: { name: asset.name, url: asset.browser_download_url },
      };
    } catch (error) {
      if (context.signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new MofoxError('UNAVAILABLE', '所有镜像均无法获取 Git for Windows 发行版信息');
}

/**
 * 顺序尝试每个镜像下载安装包，首个成功即采用。
 */
async function downloadAsset(url: string, destination: string, context: DependencyInstallContext): Promise<void> {
  const mirrors = context.mirrors?.filter((m) => m.type === 'github') ?? [];
  const candidates =
    mirrors.length > 0
      ? mirrors.map((m) => resolveProxiedUrl(m, url))
      : [url];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      await downloadRange(candidate, destination, context.signal ? { signal: context.signal } : {});
      return;
    } catch (error) {
      if (context.signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new MofoxError('IO_ERROR', '所有镜像均无法下载 Git 安装包');
}

/**
 * 根据镜像类型解析实际下载地址：直连镜像使用原始 URL；代理镜像前缀包装。
 */
function resolveProxiedUrl(mirror: { baseUrl: string }, originalUrl: string): string {
  if (mirror.baseUrl === 'https://github.com' || mirror.baseUrl === 'https://api.github.com') {
    return originalUrl;
  }
  return `${mirror.baseUrl}/${originalUrl}`;
}
