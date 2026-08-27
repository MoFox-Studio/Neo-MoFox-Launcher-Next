/** 安装流水线可能执行的固定任务；未选择平台或 WebUI 时对应步骤会跳过。 */
export type InstallStepId =
  'install-mofox' | 'install-platform' | 'install-webui' | 'configure' | 'finalize';

/** 可由安装任务发出的终态或进行中状态。 */
export type InstallTaskStatus = 'pending' | 'running' | 'failed' | 'cancelled' | 'done';

/** MoFox 本体仓库的跟踪分支；`main` 为稳定版，`dev` 为开发版。 */
export type MofoxBranch = 'main' | 'dev';

/**
 * 发起安装任务所需的全部用户选择。
 *
 * `platformId` 为空字符串表示仅安装 MoFox 本体与可选 WebUI，不安装任何平台适配器。
 */
export interface InstallRequest {
  instanceName: string;
  /** 平台适配器 ID（`napcat`/`snowluma`）；空字符串表示不安装平台。 */
  platformId: string;
  /** MoFox 本体仓库的跟踪分支。 */
  mofoxBranch: MofoxBranch;
  /** MoFox OneBot 服务监听端口，也是平台 WS 客户端要连接的目标端口。 */
  wsPort: number;
  /** 机器人账号 QQ 号；平台 WS 端点按此 QQ 号写入平台配置。 */
  botQQ: string;
  /** 机器人账号昵称，写入 OneBot 适配器的 `[bot]` 节。 */
  botNickname: string;
  /** 具有管理权限的主人 QQ 号，写入 `core.toml` 的 `owner_list`。 */
  ownerQQ: string;
  /** 大语言模型 API 密钥，写入 `model.toml`。 */
  apiKey: string;
  /** 是否安装 WebUI 插件（`neo-mofox-webui`）。 */
  installWebui: boolean;
  /** WebUI 插件的 HTTP 路由访问密钥；仅在 `installWebui` 为真时写入。 */
  webuiApiKey: string;
  /** 实例安装目录绝对路径；安装完成后作为实例根目录。 */
  targetDir: string;
}

/** 单份协议文档；`source` 为实际命中的镜像源名称。 */
export interface LicenseDocument {
  source: string;
  content: string;
}

/** 拉取 MoFox 许可协议的结果：最终用户许可协议（EULA）与隐私政策。 */
export interface LicenseFetchResult {
  eula: LicenseDocument;
  privacy: LicenseDocument;
}

/**
 * 安装流水线向界面推送的进度事件。
 * `progress` 仅表示当前步骤的进度，值为 -1 时调用方应展示不确定状态。
 */
export interface InstallProgressEvent {
  taskId: string;
  instanceName: string;
  step: InstallStepId;
  stepIndex: number;
  stepCount: number;
  status: InstallTaskStatus;
  /** 当前步骤内的 0..1 进度；无法测量时为 -1。 */
  progress: number;
  message: string;
}

/**
 * 安装目标目录的可用性探测结果。
 * 由主进程基于目标目录所在盘符/文件系统的实际状态计算，供安装向导在进入下一步前校验。
 */
export interface InstallTargetCheck {
  /** 输入内容是否为绝对路径。 */
  absolute: boolean;
  /** 路径对应的文件系统条目是否存在。 */
  exists: boolean;
  /** 存在时是否为目录。 */
  isDirectory: boolean;
  /** 是否拥有写入权限，即能否在目录内新建文件夹。 */
  writable: boolean;
  /** 目标目录所在文件系统的剩余可用空间（字节）；无法探测时为 null。 */
  freeSpaceBytes: number | null;
  /** 目标目录所在文件系统的总空间（字节）；无法探测时为 null。 */
  totalSpaceBytes: number | null;
}
