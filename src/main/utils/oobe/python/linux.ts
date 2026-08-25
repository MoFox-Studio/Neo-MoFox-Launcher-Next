import { MofoxError } from '../../../../shared/domain/error';
import { parseOsRelease } from '../../platform-helper';
import type { PackageManager } from '../../../../shared/domain/system-env';
import { readFile } from 'node:fs/promises';
import { runOneShot } from '../../process-helper';
import type { DependencyInstallContext } from '../types';

/** 各包管理器安装 python3 / venv / pip 的最小命令；非交互选项已固化。 */
const PACKAGE_MANAGER_COMMANDS: Record<PackageManager, readonly string[]> = {
  apt: ['apt-get', 'install', '-y', 'python3', 'python3-venv', 'python3-pip'],
  pacman: ['pacman', '-Sy', '--noconfirm', 'python', 'python-pip'],
  dnf: ['dnf', 'install', '-y', 'python3', 'python3-pip'],
  yum: ['yum', 'install', '-y', 'python3', 'python3-pip'],
  zypper: ['zypper', 'install', '-y', 'python3', 'python3-pip'],
};

/**
 * 在 Linux 上通过包管理器安装 Python 3 及 pip/venv；sudo 调用经 stdin 注入密码。
 *
 * @param context - 安装上下文，使用其 `sudoPassword` 字段。
 * @returns 安装结束时返回当前包管理器名。
 */
export async function installPythonLinux(context: DependencyInstallContext): Promise<string> {
  const packageManager = await resolvePackageManager();
  if (!packageManager) {
    throw new MofoxError('UNAVAILABLE', '无法识别当前 Linux 发行版的包管理器');
  }
  const command = PACKAGE_MANAGER_COMMANDS[packageManager];
  context.onProgress?.(`通过 ${packageManager} 安装 Python...`, 0.1);
  await runSudo(command, context);
  return packageManager;
}

/** 解析当前发行版的包管理器；无法识别时返回 `undefined`。 */
async function resolvePackageManager(): Promise<PackageManager | undefined> {
  try {
    const osRelease = await readFile('/etc/os-release', 'utf8');
    return parseOsRelease(osRelease).packageManager;
  } catch {
    return undefined;
  }
}

/** 通过 `sudo -S` 执行包管理器命令，密码经 stdin 注入；密码缺失时直接抛出。 */
async function runSudo(command: readonly string[], context: DependencyInstallContext): Promise<void> {
  if (!context.sudoPassword) {
    throw new MofoxError('INVALID_ARGUMENT', 'Linux 安装依赖需要 sudo 密码');
  }
  const result = await runOneShot('sudo', ['-S', ...command], {
    timeoutMs: 600_000,
    input: `${context.sudoPassword}\n`,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `包管理器安装失败: ${result.stderr || result.stdout}`);
  }
}
