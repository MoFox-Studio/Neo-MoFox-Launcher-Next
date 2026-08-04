import { spawn } from 'node:child_process';
import { MofoxError } from '../../../shared/domain/error';
import { isWindows } from '../platform-helper';
import type { DependencyInstaller, DependencyInstallContext } from './types';

/**
 * uv 安装器：通过 astral.sh 官方脚本跨平台安装。
 *
 * - Windows: PowerShell 拉取并执行 `install.ps1`。
 * - 其他平台: `curl -LsSf ... | sh`。
 *
 * uv 不分系统，所有平台共用此实现；不依赖 sudo 密码。
 * 是否已安装的探测由 `EnvironmentService.detect()` 统一完成。
 */
export const uvInstaller: DependencyInstaller = {
  id: 'uv',
  displayName: 'uv',
  async install(context: DependencyInstallContext) {
    context.onProgress?.('正在通过 astral.sh 安装 uv...', 0.1);
    if (isWindows()) {
      await runPowershellInstall(context);
    } else {
      await runShellInstall(context);
    }
    return 'astral';
  },
};

/** Windows 下用 PowerShell 执行官方安装脚本。 */
function runPowershellInstall(context: DependencyInstallContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "irm https://astral.sh/uv/install.ps1 | iex",
    ];
    const child = spawn('powershell.exe', args, {
      windowsHide: true,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => reject(new MofoxError('IO_ERROR', `uv 安装失败: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new MofoxError('IO_ERROR', `uv 安装失败: ${stderr}`));
    });
  });
}

/** Linux/macOS 下用 `curl -LsSf ... | sh` 执行官方安装脚本。 */
function runShellInstall(context: DependencyInstallContext): Promise<void> {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', ['-LsSf', 'https://astral.sh/uv/install.sh'], {
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const sh = spawn('sh', [], {
      ...(context.signal ? { signal: context.signal } : {}),
    });
    let stderr = '';
    curl.stderr?.setEncoding('utf8');
    sh.stderr?.setEncoding('utf8');
    sh.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    curl.once('error', (error) => {
      sh.kill('SIGKILL');
      reject(new MofoxError('IO_ERROR', `curl 拉取 uv 脚本失败: ${error.message}`));
    });
    sh.once('error', (error) => {
      curl.kill('SIGKILL');
      reject(new MofoxError('IO_ERROR', `sh 执行 uv 脚本失败: ${error.message}`));
    });
    sh.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new MofoxError('IO_ERROR', `uv 安装失败: ${stderr}`));
    });
    curl.stdout.pipe(sh.stdin);
  });
}
