import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BaseBotPlatform } from '../base-platform';
import type { StartCommand } from '../../../shared/domain/bot-platform';
import type {
  InstallContext,
  InstallResult,
  PlatformConfigureInput,
} from '../../../shared/domain/bot-platform';
import { MofoxError } from '../../../shared/domain/error';
import { hasFiles, installGithubRelease } from '../../utils/git/github-installer';
import { writeOnebotAdapterConfig } from '../onebot-adapter';

// SnowLuma 平台适配器：定义 Release 资产筛选、安装根校验与多级启动入口探测。
export class SnowLumaPlatform extends BaseBotPlatform {
  readonly id = 'snowluma';
  readonly name = 'SnowLuma';
  readonly description = '基于 SnowLuma 的 OneBot 11 接入，跨平台轻量，推荐使用。';
  readonly supportedPlatforms = ['win32', 'linux'] as Array<'win32' | 'linux'>;
  readonly supportedArch = ['x64', 'arm64'] as Array<'x64' | 'arm64'>;

  /** 构造 SnowLuma 平台实例并固定版本号。 */
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
      (release) =>
        release.assets.find(
          (asset) =>
            !asset.name.includes('-lite') &&
            asset.name.startsWith(`SnowLuma-${release.tag_name}-${platformPart}`) &&
            (asset.name.endsWith('.zip') || asset.name.endsWith('.tar.gz')),
        ),
      async (root) =>
        (await hasFiles(root, ['index.mjs'])) &&
        ((await hasFiles(root, ['launcher.bat'])) ||
          (await hasFiles(root, ['launcher.sh'])) ||
          (await hasFiles(root, ['package.json']))),
    );
  }

  /**
   * 写入 SnowLuma 的 OneBot 账号级配置，并同步 MoFox 的 OneBot 适配器端口。
   *
   * SnowLuma 按 QQ 号存放 `config/onebot_<uin>.json`，其中的 WS 客户端
   * 主动连接 MoFox 的 OneBot 服务，因此端口必须与适配器配置保持一致。
   *
   * @param _instanceId - 当前实例 ID（保留，当前版本未使用）。
   * @param platformPath - SnowLuma 安装根目录。
   * @param options - 端口、QQ 号与 MoFox config 目录等配置数据。
   */
  override async configure(
    _instanceId: string,
    platformPath: string,
    options: PlatformConfigureInput,
  ): Promise<void> {
    const configRoot = join(platformPath, 'config');
    await writeJson(join(configRoot, `onebot_${options.botQQ}.json`), {
      networks: {
        httpServers: [],
        httpClients: [],
        wsServers: [],
        wsClients: [
          {
            name: 'MoFox',
            enabled: true,
            url: `ws://127.0.0.1:${options.wsPort}`,
            role: 'Universal',
            accessToken: '',
            messageFormat: 'array',
            reportSelfMessage: false,
            reconnectIntervalMs: 5000,
          },
        ],
      },
      musicSignUrl: '',
    });
    await writeOnebotAdapterConfig(options.mofoxConfigDir, options.wsPort, options.botQQ, options.botNickname);
  }

  /**
   * 在平台安装路径中探测 SnowLuma 启动命令。
   *
   * v2 起 `platformPath` 是平台启动命令的唯一路径来源，不再回退到兄弟目录。
   * 启动顺序：自定义实例脚本 > 官方 launcher 脚本 > 内置 node + index.mjs > 系统 node + index.mjs。
   *
   * @param platformPath - 平台适配器的安装根目录。
   * @param instanceId - 当前实例 ID，用于定位实例专属脚本。
   * @returns 包含命令、参数、工作目录与环境变量的启动命令对象。
   * @throws {MofoxError} 未找到任何可用启动入口时抛出 `NOT_FOUND`。
   */
  async getStartCommand(platformPath: string, instanceId = ''): Promise<StartCommand> {
    const env = { SNOWLUMA_WEBUI_PORT: '5099', SNOWLUMA_HOOK_AUTOLOAD: '1' };
    const root = platformPath;
    // 自定义实例脚本优先于官方启动器和 Node 直接执行，以保留用户级配置。
    const custom = join(
      root,
      process.platform === 'win32'
        ? `start_snowluma_${instanceId}.bat`
        : `start_snowluma_${instanceId}.sh`,
    );
    if (await exists(custom)) return { command: custom, args: [], cwd: root, env };
    const launcher = join(root, process.platform === 'win32' ? 'launcher.bat' : 'launcher.sh');
    if (await exists(launcher)) return { command: launcher, args: [], cwd: root, env };
    const bundledNode = join(root, process.platform === 'win32' ? 'node.exe' : 'node');
    const entry = join(root, 'index.mjs');
    if ((await exists(bundledNode)) && (await exists(entry)))
      return { command: bundledNode, args: [entry], cwd: root, env };
    if (await exists(entry)) return { command: 'node', args: [entry], cwd: root, env };
    throw new MofoxError('NOT_FOUND', `未找到 SnowLuma 实例启动入口: ${platformPath}`);
  }
}

/**
 * 检查路径是否可访问。
 *
 * @param path - 待检查的路径。
 * @returns 路径存在返回 `true`，否则返回 `false`。
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 以 JSON 格式写入文件，自动创建父目录。
 *
 * @param path - 目标文件路径。
 * @param data - 待序列化的对象。
 */
async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
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
  throw new MofoxError(
    'UNAVAILABLE',
    `SnowLuma 不支持当前系统 ${process.platform} ${process.arch}`,
  );
}
