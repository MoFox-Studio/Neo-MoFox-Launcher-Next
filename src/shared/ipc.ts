/**
 * Single source of truth for the IPC contract shared between
 * main, preload and renderer. (Quality gate 01)
 */
import type { SystemEnvInfo } from './domain/system-env';
import type { MirrorSelection, MirrorSource } from './domain/mirror';
import type { BotPlatformMetadata } from './domain/bot-platform';
import type { LogEntry } from './domain/logger';
import type { DownloadProgress } from './domain/download';
import type {
  Instance,
  InstanceProcessSource,
  InstanceStats,
  InstanceStatus,
  InstallProgressEvent,
  InstallRequest,
  LauncherSettings,
} from './domain/instance';

export type Unsubscribe = () => void;

export const IPC_INVOKE_CHANNELS = {
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  listInstances: 'instances:list',
  startInstance: 'instances:start',
  stopInstance: 'instances:stop',
  restartInstance: 'instances:restart',
  removeInstance: 'instances:remove',
  openInstanceFolder: 'instances:open-folder',
  getInstanceLogBuffer: 'instances:log-buffer',
  clearInstanceLogBuffer: 'instances:log-clear',
  writeInstancePty: 'instances:pty-write',
  resizeInstancePty: 'instances:pty-resize',
  getInstanceStats: 'instances:stats',
  exportInstanceLogs: 'instances:export-logs',
  startInstall: 'install:start',
  retryInstall: 'install:retry',
  cancelInstall: 'install:cancel',
  detectSystemEnv: 'environment:detect',
  listMirrors: 'mirrors:list',
  selectBestMirror: 'mirrors:select-best',
  listBotPlatforms: 'bot-platforms:list',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
} as const satisfies Record<Exclude<keyof MofoxApi, 'on'>, string>;

export const IPC_EVENT_CHANNELS = {
  'log-output': 'event:log-output',
  'install-progress': 'event:install-progress',
  'instance-pty-data': 'event:instance-pty-data',
  'instance-status-changed': 'event:instance-status-changed',
  'window-maximize-changed': 'event:window-maximize-changed',
  'download-progress': 'event:download-progress',
} as const satisfies Record<keyof MofoxEventMap, string>;

export interface MofoxEventMap {
  'log-output': LogEntry;
  'install-progress': InstallProgressEvent;
  'instance-pty-data': { instanceId: string; source: InstanceProcessSource; data: string };
  'instance-status-changed': { instanceId: string; status: InstanceStatus };
  'window-maximize-changed': boolean;
  'download-progress': DownloadProgress;
}

export interface MofoxApi {
  // Window controls
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<void>;
  windowClose(): Promise<void>;
  windowIsMaximized(): Promise<boolean>;

  // Instances
  listInstances(): Promise<Instance[]>;
  startInstance(instanceId: string): Promise<void>;
  stopInstance(instanceId: string): Promise<void>;
  restartInstance(instanceId: string): Promise<void>;
  removeInstance(instanceId: string): Promise<void>;
  openInstanceFolder(instanceId: string): Promise<void>;
  getInstanceLogBuffer(instanceId: string, source: InstanceProcessSource): Promise<string>;
  clearInstanceLogBuffer(instanceId: string, source: InstanceProcessSource): Promise<void>;
  writeInstancePty(instanceId: string, source: InstanceProcessSource, data: string): Promise<void>;
  resizeInstancePty(instanceId: string, source: InstanceProcessSource, cols: number, rows: number): Promise<void>;
  getInstanceStats(instanceId: string): Promise<InstanceStats>;
  /** Returns the exported file path */
  exportInstanceLogs(instanceId: string, source: InstanceProcessSource): Promise<string>;

  // Install
  startInstall(request: InstallRequest): Promise<string>;
  retryInstall(taskId: string): Promise<void>;
  cancelInstall(taskId: string): Promise<void>;

  // Environment / mirrors / platforms
  detectSystemEnv(): Promise<SystemEnvInfo>;
  listMirrors(): Promise<MirrorSource[]>;
  selectBestMirror(): Promise<MirrorSelection>;
  listBotPlatforms(): Promise<BotPlatformMetadata[]>;

  // Settings
  getSettings(): Promise<LauncherSettings>;
  updateSettings(patch: Partial<LauncherSettings>): Promise<LauncherSettings>;

  // Events
  on<K extends keyof MofoxEventMap>(
    event: K,
    listener: (payload: MofoxEventMap[K]) => void,
  ): Unsubscribe;
}
