import { MofoxError } from '../../../../shared/domain/error';
import { runOneShot } from '../../process-service';
import type { DependencyInstallContext } from '../types';

/**
 * 在 macOS 上通过 Homebrew 安装 Git。
 *
 * brew 本身不需要 sudo；密码字段在 macOS 路径下不使用。
 *
 * @param context - 安装上下文（仅使用进度回调与取消信号）。
 * @returns 安装结束标识字符串。
 */
export async function installGitDarwin(context: DependencyInstallContext): Promise<string> {
  context.onProgress?.('通过 Homebrew 安装 git...', 0.1);
  const result = await runOneShot('brew', ['install', 'git'], {
    timeoutMs: 600_000,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `Homebrew 安装失败: ${result.stderr || result.stdout}`);
  }
  return 'brew';
}
