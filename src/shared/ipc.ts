/** 主进程、预加载脚本与渲染进程共用的 IPC 契约唯一来源。 */
import type { SystemEnvInfo } from './domain/system-env';
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
  LegacyLauncherInfo,
  MigrationPreview,
  MigrationResult,
} from './domain/instance';
import type { OobeCompletionSummary, OobeDependencyStatus, OobeProgress } from './domain/oobe';
import type {
  DirectoryPickerOptions,
  DirectoryPickerResult,
  FilePickerOptions,
  FilePickerResult,
} from './domain/file-picker';
import type { WallpaperAsset } from './domain/wallpaper';

/** 事件订阅的释放函数；必须由调用方在不再监听时执行。 */
export type Unsubscribe = () => void;

/**
 * 仅允许预加载层调用这些请求通道。
 * `satisfies` 将对象键与公开 API 保持同步，同时保留字面量通道类型。
 */
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
  listBotPlatforms: 'bot-platforms:list',
  getSettings: 'settings:get',
  updateSettings: 'settings:update',
  detectLegacyLauncher: 'migration:detect-legacy',
  previewLegacyMigration: 'migration:preview',
  importLegacyMigration: 'migration:import',
  oobeVerifySudo: 'oobe:verify-sudo',
  oobeInspectDependencies: 'oobe:inspect-dependencies',
  oobeInstallDependencies: 'oobe:install-dependencies',
  oobeCancelInstall: 'oobe:cancel-install',
  oobeComplete: 'oobe:complete',
  pickFile: 'dialog:pick-file',
  pickDirectory: 'dialog:pick-directory',
  selectWallpaper: 'wallpaper:select',
  commitWallpaper: 'wallpaper:commit',
  discardWallpaper: 'wallpaper:discard',
  removeWallpaper: 'wallpaper:remove',
} as const satisfies Record<Exclude<keyof MofoxApi, 'on'>, string>;

export const IPC_EVENT_CHANNELS = {
  'log-output': 'event:log-output',
  'install-progress': 'event:install-progress',
  'instance-pty-data': 'event:instance-pty-data',
  'instance-status-changed': 'event:instance-status-changed',
  'window-maximize-changed': 'event:window-maximize-changed',
  'download-progress': 'event:download-progress',
  'oobe-progress': 'event:oobe-progress',
} as const satisfies Record<keyof MofoxEventMap, string>;

/** 从主进程推送至渲染进程的事件载荷映射。 */
export interface MofoxEventMap {
  'log-output': LogEntry;
  'install-progress': InstallProgressEvent;
  'instance-pty-data': { instanceId: string; source: InstanceProcessSource; data: string };
  'instance-status-changed': { instanceId: string; status: InstanceStatus };
  'window-maximize-changed': boolean;
  'download-progress': DownloadProgress;
  'oobe-progress': OobeProgress;
}

export interface MofoxApi {
  /** 窗口控制。 */
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<void>;
  windowClose(): Promise<void>;
  windowIsMaximized(): Promise<boolean>;

  /** 实例生命周期、终端与日志操作。 */
  listInstances(): Promise<Instance[]>;
  startInstance(instanceId: string): Promise<void>;
  stopInstance(instanceId: string): Promise<void>;
  restartInstance(instanceId: string): Promise<void>;
  removeInstance(instanceId: string): Promise<void>;
  openInstanceFolder(instanceId: string): Promise<void>;
  getInstanceLogBuffer(instanceId: string, source: InstanceProcessSource): Promise<string>;
  clearInstanceLogBuffer(instanceId: string, source: InstanceProcessSource): Promise<void>;
  writeInstancePty(instanceId: string, source: InstanceProcessSource, data: string): Promise<void>;
  resizeInstancePty(
    instanceId: string,
    source: InstanceProcessSource,
    cols: number,
    rows: number,
  ): Promise<void>;
  getInstanceStats(instanceId: string): Promise<InstanceStats>;
  /** 导出完成后返回生成文件的绝对路径。 */
  exportInstanceLogs(instanceId: string, source: InstanceProcessSource): Promise<string>;

  /** 安装任务控制。 */
  startInstall(request: InstallRequest): Promise<string>;
  retryInstall(taskId: string): Promise<void>;
  cancelInstall(taskId: string): Promise<void>;

  /** 系统探测与平台元数据查询。 */
  detectSystemEnv(): Promise<SystemEnvInfo>;
  listBotPlatforms(): Promise<BotPlatformMetadata[]>;

  /** 启动器设置读取与局部更新。 */
  getSettings(): Promise<LauncherSettings>;
  updateSettings(patch: Partial<LauncherSettings>): Promise<LauncherSettings>;

  /** 从旧启动器数据目录探测、预览并导入实例。 */
  detectLegacyLauncher(): Promise<LegacyLauncherInfo | null>;
  previewLegacyMigration(): Promise<MigrationPreview>;
  importLegacyMigration(): Promise<MigrationResult>;

  /** OOBE 首次引导：检测依赖、按用户确认安装、验证 Linux sudo 密码并标记完成。 */
  oobeVerifySudo(password: string): Promise<boolean>;
  oobeInspectDependencies(): Promise<OobeDependencyStatus[]>;
  oobeInstallDependencies(): Promise<OobeDependencyStatus[]>;
  oobeCancelInstall(): Promise<void>;
  oobeComplete(): Promise<OobeCompletionSummary>;

  /**
   * 通用对话框：选择文件或文件夹。
   * 用户取消时返回 null；多选文件时返回全部选中路径。
   */
  pickFile(options?: FilePickerOptions): Promise<FilePickerResult>;
  pickDirectory(options?: DirectoryPickerOptions): Promise<DirectoryPickerResult>;

  /** 通过主进程受控对话框选择并暂存媒体，供渲染端取色成功后提交。 */
  selectWallpaper(): Promise<WallpaperAsset | null>;
  commitWallpaper(assetId: string): Promise<LauncherSettings>;
  discardWallpaper(assetId: string): Promise<void>;
  removeWallpaper(): Promise<LauncherSettings>;

  /**
   * 按事件名关联载荷类型的订阅入口。
   * 返回的释放函数必须移除预加载层包装后的同一监听器，而非原始回调。
   */
  on<K extends keyof MofoxEventMap>(
    event: K,
    listener: (payload: MofoxEventMap[K]) => void,
  ): Unsubscribe;
}
