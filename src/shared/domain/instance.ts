export type InstanceStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'error';

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

/** An instance runs up to two processes: the MoFox bot itself and the platform adapter. */
export type InstanceProcessSource = 'mofox' | 'platform';

export interface ProcessStats {
  running: boolean;
  /** Milliseconds since the process started, null when not running */
  uptimeMs: number | null;
  pid: number | null;
}

export type InstanceStats = Record<InstanceProcessSource, ProcessStats>;

export type InstallStepId =
  | 'prepare'
  | 'download'
  | 'extract'
  | 'dependencies'
  | 'configure'
  | 'finalize';

export type InstallTaskStatus = 'pending' | 'running' | 'failed' | 'cancelled' | 'done';

export interface InstallRequest {
  instanceName: string;
  platformId: string;
  version: string;
  targetDir: string;
  mirrorId?: string;
}

export interface InstallProgressEvent {
  taskId: string;
  instanceName: string;
  step: InstallStepId;
  stepIndex: number;
  stepCount: number;
  status: InstallTaskStatus;
  /** 0..1 progress inside the current step, -1 when indeterminate */
  progress: number;
  message: string;
}

export type ThemeMode = 'system' | 'light' | 'dark';

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
