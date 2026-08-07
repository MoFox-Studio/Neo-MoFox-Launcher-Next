/** 实例仓库文件格式版本；每次字段或语义变更必须递增并提供迁移分支。 */
export const INSTANCES_VERSION = 2;

/** 实例仓库磁盘布局：版本号 + 规范化实例数组。 */
export interface InstanceRepositoryFile {
  version: number;
  instances: Instance[];
}

/** 实例生命周期状态；过渡状态用于阻止重复的启停操作。 */
export type InstanceStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

/**
 * 平台路径字典：键为平台 ID（如 `napcat`、`snowluma`），值为该平台适配器的安装目录绝对路径。
 * 这是平台启动命令的唯一路径来源，运行时服务据此直接调用 `getStartCommand(platformPath, instanceId)`。
 */
export type PlatformPaths = Record<string, string>;

/** 用户手动修改实例运行目录时允许提交的字段。 */
export interface InstancePathUpdate {
  mofoxInstallDir: string;
  platforms: PlatformPaths;
}

/** 持久化的机器人实例及其运行状态摘要。 */
export interface Instance {
  id: string;
  name: string;
  version: string;
  /** MoFox 本体的安装目录绝对路径；运行时据此启动 `main.py`。 */
  mofoxInstallDir: string;
  /** 平台 ID 到平台安装路径的映射；当前业务为单平台，但以字典形式存放以便未来扩展。 */
  platforms: PlatformPaths;
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
