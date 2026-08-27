import type {
  BotPlatform,
  InstallContext,
  InstallResult,
  PlatformAvailability,
  PlatformConfigureInput,
  StartCommand,
} from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';

// 所有机器人平台的基础契约：集中提供宿主兼容性判断和未实现能力的统一错误语义。
export abstract class BaseBotPlatform implements BotPlatform {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  /** GitHub 仓库的 `owner/repo` 字符串，供版本列表查询与更新复用。 */
  abstract readonly repository: string;
  abstract readonly supportedPlatforms: Array<'win32' | 'linux' | 'darwin'>;
  abstract readonly supportedArch: Array<'x64' | 'arm64'>;

  readonly latestVersion: string;

  protected constructor(latestVersion: string) {
    this.latestVersion = latestVersion;
  }

  /**
   * 根据当前宿主操作系统与架构生成平台可用性检测结果。
   *
   * @returns 包含是否可用、失败原因与可展示需求项的 PlatformAvailability 对象。
   */
  async isAvailable(): Promise<PlatformAvailability> {
    const platform = process.platform as 'win32' | 'linux' | 'darwin';
    const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : process.arch;
    // 平台实现声明支持矩阵，基础层据当前宿主生成可直接展示给用户的检测结果。
    const available =
      this.supportedPlatforms.includes(platform) &&
      this.supportedArch.includes(arch as 'x64' | 'arm64');
    return {
      available,
      reason: available ? undefined : `${this.name} 不支持当前系统 ${platform} ${arch}`,
      requirements: [
        { label: `${this.name} 运行环境`, satisfied: available, detail: `${platform} ${arch}` },
      ],
    };
  }

  /**
   * 默认安装入口；子类必须覆写以提供具体的下载与解压逻辑。
   *
   * @param _context - 安装上下文（工作目录、目标目录、镜像源、取消信号等）。
   * @returns 子类实现返回的安装结果（版本与安装路径）。
   * @throws {MofoxError} 始终抛出 `UNAVAILABLE`，提示未配置下载源。
   */
  async install(_context: InstallContext): Promise<InstallResult> {
    // 子类须显式提供下载实现，避免默认行为在未配置来源时产生误导性结果。
    throw new MofoxError('UNAVAILABLE', `${this.name} 安装器尚未配置下载源`);
  }

  /**
   * 默认配置入口；子类可覆写以在安装完成后注入平台特定配置。
   *
   * @param _instanceId - 当前实例 ID。
   * @param _platformPath - 平台适配器的安装根目录。
   * @param _options - 平台安装后配置所需的业务数据（端口、QQ 号、适配器目录等）。
   * @throws {MofoxError} 始终抛出 `UNAVAILABLE`，提示未配置配置器。
   */
  async configure(
    _instanceId: string,
    _platformPath: string,
    _options: PlatformConfigureInput,
  ): Promise<void> {
    throw new MofoxError('UNAVAILABLE', `${this.name} 配置器尚未配置`);
  }

  /**
   * 返回构造时注入的 latestVersion 字段，作为未接入远程版本接口时的回退值。
   *
   * @returns 当前平台的最新版本号字符串。
   */
  async getLatestVersion(): Promise<string> {
    return this.latestVersion;
  }

  /**
   * 默认更新入口：委托安装器完成下载-替换流程。
   *
   * 平台安装与更新复用同一套「按版本下载解压」逻辑，`context.version` 决定
   * 拉取最新发行版还是指定 tag 的发行版；子类可覆写以注入平台特定行为。
   *
   * @param context - 安装上下文。
   * @returns 安装结果（版本与安装路径）。
   */
  async update(context: InstallContext): Promise<InstallResult> {
    return this.install(context);
  }

  /**
   * 返回实例的启动命令；具体平台需根据平台安装路径探测入口文件。
   *
   * @param platformPath - 平台适配器的安装根目录；是平台启动命令的唯一路径来源。
   * @param instanceId - 当前实例 ID，部分平台用于生成实例专属脚本。
   * @returns 包含可执行命令、参数、工作目录与环境变量的 StartCommand。
   */
  abstract getStartCommand(platformPath: string, instanceId?: string): Promise<StartCommand>;
}
