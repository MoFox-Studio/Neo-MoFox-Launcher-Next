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
  /** 平台适配器的最终安装目录绝对路径；安装完成后写入 `platforms[platformId]`。 */
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
