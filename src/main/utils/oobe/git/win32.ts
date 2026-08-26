import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MofoxError } from '../../../../shared/domain/error';
import { downloadReleaseAsset } from '../../github-installer';
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
 * 发行版查询、资产选择与下载统一复用 `github-installer` 的镜像轮询逻辑，
 * 首个成功即采用；下载失败或安装包执行失败时抛出。
 */
async function downloadAndInstall(context: DependencyInstallContext): Promise<string> {
  context.onProgress?.('正在查询 Git for Windows 最新发行版...', 0.2);
  const installerPath = join(context.workDir, 'git-for-windows-installer.exe');
  const { assetName, version } = await downloadReleaseAsset({
    mirrors: context.mirrors ?? [],
    repository: 'git-for-windows/git',
    selectAsset: (release) =>
      release.assets.find((candidate) => candidate.name.endsWith('-64-bit.exe')),
    destination: installerPath,
    signal: context.signal,
  });

  context.onProgress?.(`正在下载 ${assetName}...`, 0.3);
  context.onProgress?.(`正在静默安装 ${assetName}...`, 0.8);
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
