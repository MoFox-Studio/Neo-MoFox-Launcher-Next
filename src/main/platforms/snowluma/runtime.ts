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

  override async install(context: InstallContext): Promise<InstallResult> {
    const platformPart = resolveAssetPlatformPart();
    // 过滤 lite 包，并同时接受 Windows ZIP 与 Linux tar.gz 的完整发行包。
    return installGithubRelease(
      context,
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

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function resolveAssetPlatformPart(): string {
  // 资产命名与可运行组合并不完全等同于基础兼容性矩阵，因此在下载前单独收敛。
  if (process.platform === 'win32' && process.arch === 'x64') return 'win-x64';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
  throw new MofoxError('UNAVAILABLE', `SnowLuma 不支持当前系统 ${process.platform} ${process.arch}`);
}
