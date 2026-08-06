import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseBotPlatform } from '../base-platform';
import type { StartCommand } from '../../../shared/domain/bot-platform';
import type { InstallContext, InstallResult } from '../../../shared/domain/bot-platform';
import { MofoxError } from '../../../shared/domain/error';
import { hasFiles, installGithubRelease } from '../github-installer';

// NapCat 平台适配器：固定 Windows Release 资产，并解析当前及旧版目录中的启动入口。
export class NapCatPlatform extends BaseBotPlatform {
  readonly id = 'napcat';
  readonly name = 'NapCat';
  readonly description = '基于 NapCatQQ 的 OneBot 11 平台接入。';
  readonly supportedPlatforms = ['win32'] as Array<'win32'>;
  readonly supportedArch = ['x64'] as Array<'x64'>;

  /** 构造 NapCat 平台实例并固定版本号。 */
  constructor() {
    super('4.2.19');
  }

  /**
   * 通过 GitHub Release 安装 NapCat Windows Shell 包。
   *
   * @param context - 安装上下文。
   * @returns 包含版本号与安装路径的安装结果。
   */
  override async install(context: InstallContext): Promise<InstallResult> {
    // 官方 Windows Shell 包的固定文件名同时充当资产选择与安装内容约束。
    return installGithubRelease(
      context,
      context.mirrors,
      'NapNeko/NapCatQQ',
      (release) => release.assets.find((asset) => asset.name === 'NapCat.Shell.Windows.Node.zip'),
      (root) => hasFiles(root, ['node.exe', 'index.js', 'napcat.bat', 'napcat']),
    );
  }

  /**
   * 当前平台无需安装后配置，故有意 no-op。
   */
  override async configure(): Promise<void> {}

  /**
   * 在平台安装路径中探测 NapCat 启动命令。
   *
   * v2 起 `platformPath` 是平台启动命令的唯一路径来源，不再回退到兄弟目录。
   * 同时探测根目录与可能存在的 `NapCat*Shell*` 子目录，以兼容不同 Release 的解压结构。
   * 启动顺序：实例专属批处理 > 内置 node.exe + index.js 直启。
   *
   * @param platformPath - 平台适配器的安装根目录。
   * @param instanceId - 当前实例 ID，用于定位实例专属批处理。
   * @returns 包含命令、参数与工作目录的启动命令对象。
   * @throws {MofoxError} 未找到任何可用启动入口时抛出 `NOT_FOUND`。
   */
  async getStartCommand(platformPath: string, instanceId = ''): Promise<StartCommand> {
    // 同时探测根目录和 Release 可能生成的 Shell 子目录，兼容不同版本的解压结构。
    const roots = [platformPath, ...(await childDirectories(platformPath))
      .filter((name) => name.startsWith('NapCat') && name.includes('Shell'))
      .map((name) => join(platformPath, name))];
    for (const root of roots) {
      // 实例专用批处理优先；缺失时退回内置 Node 和入口文件直接启动。
      const batch = join(root, `start_napcat_${instanceId}.bat`);
      if (await exists(batch)) return { command: batch, args: [], cwd: root };
      const node = join(root, 'node.exe');
      const entry = join(root, 'index.js');
      if (await exists(node) && await exists(entry)) return { command: node, args: [entry, '-q', instanceId], cwd: root };
    }
    throw new MofoxError('NOT_FOUND', `未找到 NapCat 实例启动入口: ${platformPath}`);
  }
}

/**
 * 列出目录下的子项名称；目录不存在或不可读时返回空数组。
 *
 * @param path - 待枚举的目录路径。
 * @returns 子项名称数组。
 */
async function childDirectories(path: string): Promise<string[]> {
  try { return await readdir(path); } catch { return []; }
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
