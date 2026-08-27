import type { MirrorSource } from './mirror';

/** 平台运行前置条件的检查结果，供界面展示不可用原因。 */
export interface SystemRequirement {
  label: string;
  satisfied: boolean;
  detail?: string;
}

/** 可被渲染层安全消费的平台静态元数据，不包含安装实现。 */
export interface BotPlatformMetadata {
  id: string;
  name: string;
  description: string;
  supportedPlatforms: Array<'win32' | 'linux' | 'darwin'>;
  supportedArch: Array<'x64' | 'arm64'>;
  latestVersion?: string;
}

/** 平台可用性及所有前置条件的完整检查结果。 */
export interface PlatformAvailability {
  available: boolean;
  reason?: string;
  requirements: SystemRequirement[];
}

/** 启动子进程所需参数；`env` 是额外环境变量而非完整环境快照。 */
export interface StartCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

/**
 * 安装和更新流程共用的执行上下文。
 * `workDir` 用于临时产物，`targetDir` 是最终安装根目录；`mirrors` 供安装器顺序轮询，调用方可通过 `signal` 取消流程。
 */
export interface InstallContext {
  instanceId: string;
  version: string;
  workDir: string;
  targetDir: string;
  mirrors: readonly MirrorSource[];
  signal?: AbortSignal;
}

/** 安装或更新成功后的可持久化结果。 */
export interface InstallResult {
  version: string;
  installPath: string;
  metadata?: Record<string, string>;
}

/** 平台安装阶段的能力契约。 */
export interface PlatformInstaller {
  install(context: InstallContext): Promise<InstallResult>;
}

/** 平台安装后配置所需的业务数据；由安装配置任务在调用平台 `configure` 时注入。 */
export interface PlatformConfigureInput {
  /** MoFox OneBot 服务监听端口；平台 WS 客户端与适配器配置都要与此一致。 */
  wsPort: number;
  /** 机器人账号 QQ 号；平台 WS 端点按此 QQ 号写入平台配置。 */
  botQQ: string;
  /** 机器人账号昵称；平台写入 OneBot 适配器的 `[bot]` 节。 */
  botNickname: string;
  /** MoFox 的 config 目录绝对路径，供平台写入 OneBot 适配器配置。 */
  mofoxConfigDir: string;
}

/** 安装完成后写入实例专属配置的能力契约。 */
export interface PlatformConfig {
  configure(
    instanceId: string,
    platformPath: string,
    options: PlatformConfigureInput,
  ): Promise<void>;
}

/** 查询版本与执行更新的能力契约。 */
export interface PlatformUpdater {
  getLatestVersion(): Promise<string>;
  update(context: InstallContext): Promise<InstallResult>;
}

/** 根据平台安装路径生成实际子进程启动命令的能力契约。 */
export interface PlatformRuntime {
  getStartCommand(platformPath: string, instanceId?: string): Promise<StartCommand>;
}

/** 一个完整平台实现必须同时提供元数据、可用性、安装、配置、更新和运行能力。 */
export interface BotPlatform
  extends BotPlatformMetadata, PlatformInstaller, PlatformConfig, PlatformUpdater, PlatformRuntime {
  isAvailable(): Promise<PlatformAvailability>;
}
