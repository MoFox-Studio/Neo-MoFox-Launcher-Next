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
  mirrorId?: string;
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
  mirrorAutoSelect: boolean;
  preferredMirrorId?: string;
  closeToTray: boolean;
  hardwareAcceleration: boolean;
  maxLogFileSizeMb: number;
  maxLogArchiveDays: number;
  compressLogArchive: boolean;
}
