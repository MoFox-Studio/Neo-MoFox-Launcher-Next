import { platform } from 'node:os';
import { MofoxError } from '../../../../shared/domain/error';
import type { DependencyInstaller, DependencyInstallContext } from '../types';
import { installUvWin32 } from './win32';
import { installUvLinux } from './linux';
import { installUvDarwin } from './darwin';

/**
 * uv 安装器：按当前平台分发到对应实现。
 *
 * - Windows: 优先 winget，失败回退到 PowerShell 执行官方脚本（预先授权脚本执行策略）。
 * - Linux/macOS: 直接执行 astral.sh 官方安装脚本。
 *
 * uv 安装到用户目录（`~/.local/bin`），全程不需要 sudo 密码。
 * 是否已安装的探测由 `EnvironmentService.detect()` 统一完成，此处只负责安装；
 * 平台不支持时抛出 `UNAVAILABLE`。
 */
export const uvInstaller: DependencyInstaller = {
  id: 'uv',
  displayName: 'uv',
  async install(context: DependencyInstallContext): Promise<string> {
    const current = platform();
    if (current === 'win32') return installUvWin32(context);
    if (current === 'linux') return installUvLinux(context);
    if (current === 'darwin') return installUvDarwin(context);
    throw new MofoxError('UNAVAILABLE', `uv 安装器不支持当前平台: ${current}`);
  },
};
