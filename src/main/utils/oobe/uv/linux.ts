import { MofoxError } from '../../../../shared/domain/error';
import { runOneShot } from '../../process-helper';
import type { DependencyInstallContext } from '../types';

/** astral.sh 官方安装脚本；`-LsSf` 静默跟随重定向且失败时返回非零退出码。 */
const OFFICIAL_INSTALL_COMMAND = 'curl -LsSf https://astral.sh/uv/install.sh | sh';

/**
 * 在 Linux 上通过 astral.sh 官方安装脚本安装 uv。
 *
 * 脚本安装到用户目录（`~/.local/bin`），不需要 sudo；不依赖系统包管理器。
 *
 * @param context - 安装上下文（仅使用进度回调与取消信号）。
 * @returns 安装完成后的来源标识字符串。
 */
export async function installUvLinux(context: DependencyInstallContext): Promise<string> {
  return runShellScriptInstall(context);
}

/** 通过 `sh -c` 执行官方安装脚本，管道在 shell 内部完成，统一走 runOneShot 的超时与中止处理。 */
async function runShellScriptInstall(context: DependencyInstallContext): Promise<string> {
  context.onProgress?.('通过 astral.sh 官方脚本安装 uv...', 0.1);
  const result = await runOneShot('sh', ['-c', OFFICIAL_INSTALL_COMMAND], {
    timeoutMs: 600_000,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `uv 安装失败: ${result.stderr || result.stdout}`);
  }
  return 'astral';
}
