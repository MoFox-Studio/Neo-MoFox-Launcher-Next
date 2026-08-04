import { platform } from 'node:os';
import { MofoxError } from '../../../../shared/domain/error';
import type { DependencyInstaller, DependencyInstallContext } from '../types';
import { installPythonWin32 } from './win32';
import { installPythonLinux } from './linux';
import { installPythonDarwin } from './darwin';

/**
 * Python 安装器：按当前平台分发到对应实现。
 *
 * 是否已安装的探测由 `EnvironmentService.detect()` 统一完成，此处只负责安装；
 * 平台不支持时抛出 `UNAVAILABLE`。
 */
export const pythonInstaller: DependencyInstaller = {
  id: 'python',
  displayName: 'Python',
  async install(context: DependencyInstallContext): Promise<string> {
    const current = platform();
    if (current === 'win32') return installPythonWin32(context);
    if (current === 'linux') return installPythonLinux(context);
    if (current === 'darwin') return installPythonDarwin(context);
    throw new MofoxError('UNAVAILABLE', `Python 安装器不支持当前平台: ${current}`);
  },
};
