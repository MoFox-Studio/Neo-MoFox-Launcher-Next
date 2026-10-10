import { MofoxError } from '../../../../shared/domain/error';
import { runOneShot } from '../../process-helper';
import type { DependencyInstallContext } from '../types';

/** winget 调用参数：固定 uv 包 ID、统一接收协议、静默安装。 */
const WINGET_ARGS = [
  'install',
  '--id',
  'astral-sh.uv',
  '-e',
  '--source',
  'winget',
  '--accept-package-agreements',
  '--accept-source-agreements',
  '--silent',
];

/** 官方安装命令：`irm` 拉取 install.ps1 后立即执行；无独立脚本文件需要落盘。 */
const POWERSHELL_INSTALL_COMMAND = 'irm https://astral.sh/uv/install.ps1 | iex';

/**
 * 在 Windows 上安装 uv：优先 winget，失败回退到 PowerShell 执行 astral.sh 官方脚本。
 *
 * 回退分支通过 `-ExecutionPolicy Bypass` 预先授权脚本执行策略，
 * 避免系统默认策略（Restricted）阻止远程脚本执行；winget 不可用或返回非零退出码时才进入该分支。
 *
 * @param context - 安装上下文（进度回调、取消信号）。
 * @returns 安装完成后的来源标识字符串（`winget` 或 `astral`）。
 */
export async function installUvWin32(context: DependencyInstallContext): Promise<string> {
  try {
    await runWinget(context);
    context.onProgress?.('winget 已安装 uv');
    return 'winget';
  } catch (error) {
    context.onProgress?.(
      `winget 不可用或失败，回退到 PowerShell 官方脚本: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return runPowershellInstall(context);
}

/** 调用 winget 完成安装；非零退出码或超时均视为失败以便回退。 */
async function runWinget(context: DependencyInstallContext): Promise<void> {
  context.onProgress?.('通过 winget 安装 uv...', 0.1);
  const result = await runOneShot('winget', WINGET_ARGS, {
    timeoutMs: 600_000,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `winget 安装失败: ${result.stderr || result.stdout}`);
  }
}

/** 回退方案：PowerShell 执行官方 install.ps1；`-ExecutionPolicy Bypass` 预先授权脚本执行。 */
async function runPowershellInstall(context: DependencyInstallContext): Promise<string> {
  context.onProgress?.('通过 PowerShell 执行 astral.sh 官方脚本...', 0.3);
  const result = await runOneShot(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_INSTALL_COMMAND],
    {
      timeoutMs: 600_000,
      ...(context.signal ? { signal: context.signal } : {}),
    },
  );
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `uv 安装失败: ${result.stderr || result.stdout}`);
  }
  return 'astral';
}
