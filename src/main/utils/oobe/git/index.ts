import { platform } from 'node:os';
import { runOneShot } from '../../process-service';
import { MofoxError } from '../../../../shared/domain/error';
import type { DependencyInstaller, DependencyInstallContext } from '../types';
import { installGitWin32 } from './win32';
import { installGitLinux } from './linux';
import { installGitDarwin } from './darwin';

/**
 * Git 安装器：按当前平台分发到对应实现，并复用统一的 `git --version` 探测逻辑。
 *
 * 探测失败时返回 `null`；安装阶段在平台不支持时抛出 `UNAVAILABLE`。
 */
export const gitInstaller: DependencyInstaller = {
  id: 'git',
  displayName: 'Git',
  async detect() {
    try {
      const result = await runOneShot('git', ['--version']);
      if (result.exitCode !== 0 || result.timedOut) return null;
      const match = `${result.stdout}\n${result.stderr}`.match(/\d+\.\d+(?:\.\d+)?/);
      return match?.[0] ?? null;
    } catch {
      return null;
    }
  },
  async install(context: DependencyInstallContext): Promise<string> {
    const current = platform();
    if (current === 'win32') return installGitWin32(context);
    if (current === 'linux') return installGitLinux(context);
    if (current === 'darwin') return installGitDarwin(context);
    throw new MofoxError('UNAVAILABLE', `Git 安装器不支持当前平台: ${current}`);
  },
};
