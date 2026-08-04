import { MofoxError } from '../../../../shared/domain/error';
import { parseOsRelease } from '../../platform-helper';
import type { PackageManager } from '../../../../shared/domain/system-env';
import { readFile } from 'node:fs/promises';
import { runOneShot } from '../../process-service';
import type { DependencyInstallContext } from '../types';

/**
 * 在 Linux 上安装 Git：根据 `/etc/os-release` 推断的包管理器调用对应安装命令。
 *
 * sudo 调用统一使用 `sudo -S` 以便经 stdin 注入密码，避免在命令行中暴露。
 *
 * @param context - 安装上下文，使用其 `sudoPassword` 字段。
 * @returns 安装命令的结束标识字符串。
 */
export async function installGitLinux(context: DependencyInstallContext): Promise<string> {
  const packageManager = await resolvePackageManager();
  if (!packageManager) {
    throw new MofoxError('UNAVAILABLE', '无法识别当前 Linux 发行版的包管理器');
  }
  const command = PACKAGE_MANAGER_COMMANDS[packageManager];
  context.onProgress?.(`通过 ${packageManager} 安装 git...`, 0.1);
  await runSudo(command, context);
  return packageManager;
}

/** 各包管理器安装 git 的最小命令；`-y`/`--noconfirm` 等非交互选项已固化。 */
const PACKAGE_MANAGER_COMMANDS: Record<PackageManager, readonly string[]> = {
  apt: ['apt-get', 'install', '-y', 'git'],
  pacman: ['pacman', '-Sy', '--noconfirm', 'git'],
  dnf: ['dnf', 'install', '-y', 'git'],
  yum: ['yum', 'install', '-y', 'git'],
  zypper: ['zypper', 'install', '-y', 'git'],
};

/**
 * 解析当前发行版的包管理器；无法识别时返回 `undefined`。
 */
async function resolvePackageManager(): Promise<PackageManager | undefined> {
  try {
    const osRelease = await readFile('/etc/os-release', 'utf8');
    return parseOsRelease(osRelease).packageManager;
  } catch {
    return undefined;
  }
}

/**
 * 通过 `sudo -S` 执行包管理器命令，密码经 stdin 注入。
 *
 * 不在命令行暴露密码；密码缺失时直接抛出 `INVALID_ARGUMENT`。
 *
 * @param command - 待以 sudo 执行的命令数组（不含 `sudo`）。
 * @param context - 安装上下文，提供 `sudoPassword` 与取消信号。
 */
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
