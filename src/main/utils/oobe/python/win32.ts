import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MofoxError } from '../../../../shared/domain/error';
import { downloadRange } from '../../range-downloader';
import { runOneShot } from '../../process-helper';
import type { DependencyInstallContext } from '../types';

// 固定下载的 Python 版本；通过 python.org FTP 直链获取稳定版。
const PYTHON_VERSION = '3.12.8';
const PYTHON_INSTALLER_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe`;

// 静默安装参数：全局安装、加入 PATH、不装测试套件、不弹 UI。
const PYTHON_SILENT_ARGS = [
  '/quiet',
  'InstallAllUsers=1',
  'PrependPath=1',
  'Include_test=0',
  'Include_launcher=1',
  'Include_pip=1',
];

/** winget 调用参数：固定 Python 3.12 ID、统一接收协议、静默安装。 */
const WINGET_ARGS = [
  'install',
  '--id',
  'Python.Python.3.12',
  '-e',
  '--source',
  'winget',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--silent',
];

/**
 * 在 Windows 上安装 Python：优先 winget，失败回退到下载 python.org 静默安装包。
 *
 * 回退分支固定从 python.org FTP 下载 64-bit 安装包；安装包在执行后回收。
 *
 * @param context - 安装上下文。
 * @returns 安装完成后的版本号字符串。
 */
export async function installPythonWin32(context: DependencyInstallContext): Promise<string> {
  try {
    await runWinget(context);
    context.onProgress?.('winget 已安装 Python');
    return PYTHON_VERSION;
  } catch (error) {
    context.onProgress?.(
      `winget 不可用或失败，回退到下载 Python 安装包: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return downloadAndInstall(context);
}

/** 调用 winget 完成安装；非零退出码或超时均视为失败以便回退。 */
async function runWinget(context: DependencyInstallContext): Promise<void> {
  context.onProgress?.('通过 winget 安装 Python...', 0.1);
  const result = await runOneShot('winget', WINGET_ARGS, {
    timeoutMs: 600_000,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `winget 安装失败: ${result.stderr || result.stdout}`);
  }
}

/** 下载 Python 安装包并静默执行；安装包在执行完成后回收。 */
async function downloadAndInstall(context: DependencyInstallContext): Promise<string> {
  const installerPath = join(context.workDir, `python-${PYTHON_VERSION}-amd64.exe`);
  context.onProgress?.(`正在下载 Python ${PYTHON_VERSION}...`, 0.3);
  await downloadRange(PYTHON_INSTALLER_URL, installerPath, context.signal ? { signal: context.signal } : {});

  context.onProgress?.(`正在静默安装 Python ${PYTHON_VERSION}...`, 0.8);
  const result = await runOneShot(installerPath, PYTHON_SILENT_ARGS, {
    timeoutMs: 600_000,
    windowsHide: true,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  await rm(installerPath, { force: true });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `Python 安装包执行失败: ${result.stderr || result.stdout}`);
  }
  return PYTHON_VERSION;
}
