/** 实例仓库文件格式版本；每次字段或语义变更必须递增并提供迁移分支。 */
export const INSTANCES_VERSION = 4;

/** 实例仓库磁盘布局：版本号 + 规范化实例数组。 */
export interface InstanceRepositoryFile {
  version: number;
  instances: Instance[];
}

/** 实例生命周期状态；过渡状态用于阻止重复的启停操作。 */
export type InstanceStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

/** 单个平台适配器的已安装信息。 */
export interface InstalledPlatform {
  /** 平台适配器的安装目录绝对路径。 */
  installDir: string;
  /** 实际安装的平台适配器发布版本；手动导入且未知时省略。 */
  version?: string;
}

/** 平台 ID（如 `napcat`、`snowluma`）到已安装平台信息的映射。 */
export type InstalledPlatforms = Record<string, InstalledPlatform>;

/** 持久化的机器人实例及其运行状态摘要。 */
export interface Instance {
  id: string;
  name: string;
  /** MoFox 本体的安装目录绝对路径；运行时据此启动 `main.py`。 */
  mofoxInstallDir: string;
  /** 平台 ID 到平台安装信息的映射；当前业务为单平台，但以字典形式存放以便未来扩展。 */
  platforms: InstalledPlatforms;
  status: InstanceStatus;
  createdAt: number;
  lastStartedAt?: number;
  autoStart: boolean;
}

/** 一个实例最多运行两个进程：MoFox 本体与平台适配器。 */
export type InstanceProcessSource = 'mofox' | 'platform';

/** 单个实例子进程的运行统计。 */
export interface ProcessStats {
  running: boolean;
  /** 自进程启动起累计的毫秒数；未运行时为 `null`。 */
  uptimeMs: number | null;
  pid: number | null;
}

/** 两类进程均有固定统计项，即使其中一类未启动也不得省略。 */
export type InstanceStats = Record<InstanceProcessSource, ProcessStats>;
