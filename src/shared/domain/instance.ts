/**
 * 实例仓库文件格式版本；每次字段或语义变更必须递增版本号，
 * 并在 `src/main/utils/instance-migrations.ts` 中提供从旧版本到新版本的一步迁移分支。
 */
export const INSTANCES_VERSION = 7;

/** 实例仓库磁盘布局：版本号 + 规范化实例数组。 */
export interface InstanceRepositoryFile {
  version: number;
  instances: Instance[];
}

/** 实例生命周期状态；过渡状态用于阻止重复的启停操作。 */
export type InstanceStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

/**
 * 单个平台适配器的已安装信息；字段缺省时统一为 `null`，保证对象结构完整覆盖全部字段。
 * 未安装平台时三者均为 `null`。
 */
export interface InstalledPlatform {
  /** 平台适配器 ID（如 `napcat`、`snowluma`）；未安装平台时为 `null`。 */
  id: string | null;
  /** 平台适配器的安装目录绝对路径；未安装平台时为 `null`。 */
  installDir: string | null;
  /** 实际安装的平台适配器发布版本；手动导入且未知时为 `null`。 */
  version: string | null;
}

/** 持久化的机器人实例及其运行状态摘要。 */
export interface Instance {
  id: string;
  name: string;
  /** MoFox 本体的安装目录绝对路径；运行时据此启动 `main.py`。 */
  mofoxInstallDir: string;
  /** 已安装的平台适配器信息；未安装平台时所有字段为 `null`。 */
  platform: InstalledPlatform;
  status: InstanceStatus;
  createdAt: number;
  /** 最后一次成功启动的时间戳（毫秒）；从未启动过时为 `null`。 */
  lastStartedAt: number | null;
  autoStart: boolean;
}

/** 新增实例的入参；仅暴露业务可配置字段，ID、状态、时间戳等由仓库在内部以默认值构建。 */
export interface CreateInstanceInput {
  /** 可选预生成 ID；缺省时由仓库生成全局唯一 ID。 */
  id?: string;
  name: string;
  /** MoFox 本体安装目录；安装向导只装平台适配器时可留空，由后续流程回填。 */
  mofoxInstallDir?: string;
  platform?: InstalledPlatform | null;
  autoStart?: boolean;
}

/** 更新实例的补丁；所有字段可选，未提供的字段保持原值。 */
export interface UpdateInstancePatch {
  name?: string;
  mofoxInstallDir?: string;
  platform?: InstalledPlatform | null;
  status?: InstanceStatus;
  lastStartedAt?: number | null;
  autoStart?: boolean;
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
