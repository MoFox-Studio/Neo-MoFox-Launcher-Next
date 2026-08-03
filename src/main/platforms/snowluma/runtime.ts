import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BaseBotPlatform } from '../base-platform';
import type { StartCommand } from '../../../shared/domain/bot-platform';
import type { InstallContext, InstallResult } from '../../../shared/domain/bot-platform';
import { MofoxError } from '../../../shared/domain/error';
import { hasFiles, installGithubRelease } from '../github-installer';

// SnowLuma 平台适配器：定义 Release 资产筛选、安装根校验与多级启动入口探测。
export class SnowLumaPlatform extends BaseBotPlatform {
  readonly id = 'snowluma';
  readonly name = 'SnowLuma';
  readonly description = '基于 SnowLuma 的 OneBot 11 平台接入。';
  readonly supportedPlatforms = ['win32', 'linux'] as Array<'win32' | 'linux'>;
  readonly supportedArch = ['x64', 'arm64'] as Array<'x64' | 'arm64'>;

  constructor() {
    super('1.9.2');
  }

  /**
   * 通过 GitHub Release 安装 SnowLuma 完整发行包。
   *
   * 自动过滤 lite 包，并根据当前系统选择 Windows ZIP 或 Linux tar.gz 资产。
   *
   * @param context - 安装上下文。
   * @returns 包含版本号与安装路径的安装结果。
   * @throws {MofoxError} 当前系统无对应发行资产时由资产选择器抛出。
   */
  override async install(context: InstallContext): Promise<InstallResult> {
    const platformPart = resolveAssetPlatformPart();
    // 过滤 lite 包，并同时接受 Windows ZIP 与 Linux tar.gz 的完整发行包。
    return installGithubRelease(
      context,
      context.mirrors,
      'SnowLuma/SnowLuma',
      (release) => release.assets.find((asset) =>
        !asset.name.includes('-lite') &&
        asset.name.startsWith(`SnowLuma-${release.tag_name}-${platformPart}`) &&
        (asset.name.endsWith('.zip') || asset.name.endsWith('.tar.gz'))),
      async (root) => (await hasFiles(root, ['index.mjs'])) &&
        ((await hasFiles(root, ['launcher.bat'])) || (await hasFiles(root, ['launcher.sh'])) || (await hasFiles(root, ['package.json']))),
    );
  }

  override async configure(): Promise<void> {}

  /**
   * 在安装目录中探测 SnowLuma 启动命令。
   *
   * 兼容旧安装布局：当前路径优先，其次查找 `neo-mofox` 同级的 `snowluma` 目录。
   * 启动顺序：自定义实例脚本 > 官方 launcher 脚本 > 内置 node + index.mjs > 系统 node + index.mjs。
   *
   * @param installPath - 平台安装根目录。
   * @param instanceId - 当前实例 ID，用于定位实例专属脚本。
   * @returns 包含命令、参数、工作目录与环境变量的启动命令对象。
   * @throws {MofoxError} 未找到任何可用启动入口时抛出 `NOT_FOUND`。
   */
  async getStartCommand(installPath: string, instanceId = ''): Promise<StartCommand> {
    const env = { SNOWLUMA_WEBUI_PORT: '5099', SNOWLUMA_HOOK_AUTOLOAD: '1' };
    // 兼容旧安装布局：当前路径优先，其次查找 neo-mofox 的同级 snowluma 目录。
    for (const root of uniquePaths([installPath, join(dirname(installPath), 'snowluma')])) {
      // 自定义实例脚本优先于官方启动器和 Node 直接执行，以保留用户级配置。
      const custom = join(root, process.platform === 'win32' ? `start_snowluma_${instanceId}.bat` : `start_snowluma_${instanceId}.sh`);
      if (await exists(custom)) return { command: custom, args: [], cwd: root, env };
      const launcher = join(root, process.platform === 'win32' ? 'launcher.bat' : 'launcher.sh');
      if (await exists(launcher)) return { command: launcher, args: [], cwd: root, env };
      const bundledNode = join(root, process.platform === 'win32' ? 'node.exe' : 'node');
      const entry = join(root, 'index.mjs');
      if (await exists(bundledNode) && await exists(entry)) return { command: bundledNode, args: [entry], cwd: root, env };
      if (await exists(entry)) return { command: 'node', args: [entry], cwd: root, env };
    }
    throw new MofoxError('NOT_FOUND', `未找到 SnowLuma 实例启动入口: ${installPath}`);
  }
}

/**
 * 对路径数组去重，保留首次出现的顺序。
 *
 * @param paths - 可能包含重复项的路径数组。
 * @returns 去重后的路径数组。
 */
function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

/**
 * 检查路径是否可访问。
 *
 * @param path - 待检查的路径。
 * @returns 路径存在返回 `true`，否则返回 `false`。
 */
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/**
 * 解析当前系统对应的发行资产命名片段。
 *
 * 资产命名与可运行组合并不完全等同于基础兼容性矩阵，因此在下载前单独收敛。
 *
 * @returns 资产文件名中的平台标识片段（如 `win-x64`、`linux-arm64`）。
 * @throws {MofoxError} 当前系统无对应发行资产时抛出 `UNAVAILABLE`。
 */
function resolveAssetPlatformPart(): string {
  // 资产命名与可运行组合并不完全等同于基础兼容性矩阵，因此在下载前单独收敛。
  if (process.platform === 'win32' && process.arch === 'x64') return 'win-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  throw new MofoxError('UNAVAILABLE', `SnowLuma 不支持当前系统 ${process.platform} ${process.arch}`);
}
