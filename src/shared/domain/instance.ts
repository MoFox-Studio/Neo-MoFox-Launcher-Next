/** 实例仓库文件格式版本；每次字段或语义变更必须递增并提供迁移分支。 */
export const INSTANCES_VERSION = 1;

/** 实例仓库磁盘布局：版本号 + 规范化实例数组。 */
export interface InstanceRepositoryFile {
  version: number;
  instances: Instance[];
}

/** 实例生命周期状态；过渡状态用于阻止重复的启停操作。 */
export type InstanceStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

/** 持久化的机器人实例及其运行状态摘要。 */
export interface Instance {
  id: string;
  name: string;
  version: string;
  platformId: string;
  installPath: string;
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

/** 安装流水线的固定步骤，`stepIndex` 按此顺序对应。 */
export type InstallStepId =
  'prepare' | 'download' | 'extract' | 'dependencies' | 'configure' | 'finalize';

/** 可由安装任务发出的终态或进行中状态。 */
export type InstallTaskStatus = 'pending' | 'running' | 'failed' | 'cancelled' | 'done';

/** 发起安装任务所需的用户选择和目标路径。 */
export interface InstallRequest {
  instanceName: string;
  platformId: string;
  version: string;
  targetDir: string;
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

/** 外观模式；`system` 跟随操作系统的颜色偏好。 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** 启动器的持久化用户设置。 */
export interface LauncherSettings {
  themeMode: ThemeMode;
  seedColor: string;
  language: 'zh-CN' | 'en-US';
  defaultInstallDir: string;
  closeToTray: boolean;
  hardwareAcceleration: boolean;
  maxLogFileSizeMb: number;
  maxLogArchiveDays: number;
  compressLogArchive: boolean;
  /** 当前受管壁纸的类型；`none` 时其余壁纸字段不参与渲染。 */
  wallpaperType: WallpaperType;
  /** 存储于应用数据目录 wallpapers 下的受管文件名，绝不保存用户原始路径。 */
  wallpaperFileName: string;
  /** 媒体本身的模糊半径，单位 px。 */
  wallpaperBlur: number;
  /** 内容表面的不透明度，值越低露出的壁纸越多。 */
  wallpaperOpacity: number;
  /** 首次引导是否已完成；未完成时应用强制停在 OOBE 路由，直到 OOBE 服务将其置为 true。 */
  oobeCompleted: boolean;
}

// ─── 旧启动器迁移 ────────────────────────────────────────────────────────

/**
 * 旧启动器在数据目录存放 `instances.json`，字段命名与当前规范不同。
 * 仅声明迁移所需字段；迁移器据此把遗留记录归一化为 {@link Instance}。
 */
export interface LegacyInstanceRecord {
  id: string;
  name?: string;
  qqNickname?: string;
  qqNumber?: string;
  neomofoxDir?: string;
  platformDir?: string;
  napcatDir?: string;
  platform?: string;
  platformVersion?: string;
  napcatVersion?: string;
  version?: string;
  neomofoxVersion?: string;
  installCompleted?: boolean;
  status?: string;
  createdAt?: unknown;
  lastStartedAt?: unknown;
  autoStart?: boolean;
  extra?: {
    displayName?: string;
    description?: string;
    isLike?: boolean;
    iconPath?: string;
  };
  [key: string]: unknown;
}

/** 旧启动器数据目录的探测结果。 */
export interface LegacyLauncherInfo {
  /** 旧启动器数据目录的绝对路径。 */
  dataDirectory: string;
  /** 旧 instances.json 中识别到的实例数量。 */
  instanceCount: number;
  /** instances.json 的最后修改时间；缺失时为 null。 */
  modifiedAt: number | null;
}

/** 单条旧实例的迁移预览，含规范化结果与冲突标记。 */
export interface LegacyInstancePreview {
  /** 规范化后的实例；导入成功后写入新仓库。 */
  instance: Instance;
  /** 与新仓库中同 ID 实例的冲突描述；无冲突时为 null。 */
  conflict: 'duplicate-id' | 'duplicate-path' | null;
  /** 解析实例名所用的来源字段，便于调试与展示。 */
  nameSource: 'name' | 'extra.displayName' | 'qqNickname' | 'id';
}

/** 迁移预览：旧启动器信息 + 每条记录的规范化与冲突结果。 */
export interface MigrationPreview {
  legacy: LegacyLauncherInfo;
  previews: LegacyInstancePreview[];
}

/** 导入操作的汇总结果。 */
export interface MigrationResult {
  /** 实际写入新仓库的实例数量（跳过冲突项后）。 */
  imported: number;
  /** 因 ID 或路径冲突而跳过的实例数量。 */
  skipped: number;
  /** 导入后新仓库中的实例总数。 */
  total: number;
}
import type { WallpaperType } from './wallpaper';
