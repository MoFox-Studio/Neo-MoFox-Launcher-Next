import type { DependencyInstaller } from './types';
import { gitInstaller } from './git';
import { pythonInstaller } from './python';
import { uvInstaller } from './uv';

export type { DependencyInstaller, DependencyInstallContext } from './types';

/**
 * OOBE 安装依赖注册表：按依赖顺序枚举所有需要安装的工具。
 *
 * 顺序固定为 git → python → uv，确保 uv 在 Python 可用后再安装以便后续
 * 实例运行时使用 `uv run python main.py`。
 */
export const DEPENDENCY_INSTALLERS: readonly DependencyInstaller[] = [
  gitInstaller,
  pythonInstaller,
  uvInstaller,
];
