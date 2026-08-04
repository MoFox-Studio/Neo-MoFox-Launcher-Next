import { platform } from 'node:os';
import { MofoxError } from '../../../../shared/domain/error';
import type { DependencyInstaller, DependencyInstallContext } from '../types';
import { installGitWin32 } from './win32';
import { installGitLinux } from './linux';
import { installGitDarwin } from './darwin';

/**
 * Git 安装器：按当前平台分发到对应实现。
 *
 * 是否已安装的探测由 `EnvironmentService.detect()` 统一完成，此处只负责安装；
 * 平台不支持时抛出 `UNAVAILABLE`。
 */
export const gitInstaller: DependencyInstaller = {
  id: 'git',
  displayName: 'Git',
  async install(context: DependencyInstallContext): Promise<string> {
    const current = platform();
    if (current === 'win32') return installGitWin32(context);
    if (current === 'linux') return installGitLinux(context);
    if (current === 'darwin') return installGitDarwin(context);
    throw new MofoxError('UNAVAILABLE', `Git 安装器不支持当前平台: ${current}`);
  },
};
