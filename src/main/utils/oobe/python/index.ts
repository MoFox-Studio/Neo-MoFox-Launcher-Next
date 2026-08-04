import { platform } from 'node:os';
import { runOneShot } from '../../process-service';
import { MofoxError } from '../../../../shared/domain/error';
import { pythonExeName } from '../../platform-helper';
import type { DependencyInstaller, DependencyInstallContext } from '../types';
import { installPythonWin32 } from './win32';
import { installPythonLinux } from './linux';
import { installPythonDarwin } from './darwin';

/**
 * Python 安装器：按当前平台分发到对应实现，并复用统一的 `python --version` 探测。
 *
 * 探测失败时返回 `null`；安装阶段在平台不支持时抛出 `UNAVAILABLE`。
 */
export const pythonInstaller: DependencyInstaller = {
  id: 'python',
  displayName: 'Python',
  async detect() {
    try {
      const result = await runOneShot(pythonExeName(), ['--version']);
      if (result.exitCode !== 0 || result.timedOut) return null;
      const match = `${result.stdout}\n${result.stderr}`.match(/\d+\.\d+(?:\.\d+)?/);
      return match?.[0] ?? null;
    } catch {
      return null;
    }
  },
  async install(context: DependencyInstallContext): Promise<string> {
    const current = platform();
    if (current === 'win32') return installPythonWin32(context);
    if (current === 'linux') return installPythonLinux(context);
    if (current === 'darwin') return installPythonDarwin(context);
    throw new MofoxError('UNAVAILABLE', `Python 安装器不支持当前平台: ${current}`);
  },
};
