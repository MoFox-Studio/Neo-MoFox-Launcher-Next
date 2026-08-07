import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  type MofoxApi,
  type MofoxEventMap,
} from '../shared/ipc';
import { deserializeIpcError } from '../shared/domain/error';

/**
 * 预加载层依赖的最小 Electron IPC 接口，便于在不加载 Electron 运行时的环境中测试。
 * 公开 API 会在本层收窄为共享契约定义的通道和参数类型。
 */
interface IpcRendererBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): unknown;
  removeListener(
    channel: string,
    listener: (event: IpcRendererEvent, payload: unknown) => void,
  ): unknown;
}

/**
 * 创建暴露给渲染进程的最小化 IPC 门面。
 * 所有请求使用共享白名单通道，并将主进程编码的错误还原为业务错误；事件订阅只接受共享事件表中的名称。
 */
export function createMofoxApi(ipc: IpcRendererBridge): MofoxApi {
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    try {
      return (await ipc.invoke(channel, ...args)) as T;
    } catch (error) {
      throw deserializeIpcError(error);
    }
  };
  return {
    windowMinimize: () => invoke(IPC_INVOKE_CHANNELS.windowMinimize),
    windowToggleMaximize: () => invoke(IPC_INVOKE_CHANNELS.windowToggleMaximize),
    windowClose: () => invoke(IPC_INVOKE_CHANNELS.windowClose),
    windowIsMaximized: () => invoke<boolean>(IPC_INVOKE_CHANNELS.windowIsMaximized),
    listInstances: () => invoke(IPC_INVOKE_CHANNELS.listInstances),
    startInstance: (instanceId) => invoke(IPC_INVOKE_CHANNELS.startInstance, instanceId),
    stopInstance: (instanceId) => invoke(IPC_INVOKE_CHANNELS.stopInstance, instanceId),
    restartInstance: (instanceId) => invoke(IPC_INVOKE_CHANNELS.restartInstance, instanceId),
    removeInstance: (instanceId) => invoke(IPC_INVOKE_CHANNELS.removeInstance, instanceId),
    openInstanceFolder: (instanceId) => invoke(IPC_INVOKE_CHANNELS.openInstanceFolder, instanceId),
    updateInstancePaths: (instanceId, update) =>
      invoke(IPC_INVOKE_CHANNELS.updateInstancePaths, instanceId, update),
    getInstanceLogBuffer: (instanceId, source) =>
      invoke(IPC_INVOKE_CHANNELS.getInstanceLogBuffer, instanceId, source),
    clearInstanceLogBuffer: (instanceId, source) =>
      invoke(IPC_INVOKE_CHANNELS.clearInstanceLogBuffer, instanceId, source),
    writeInstancePty: (instanceId, source, data) =>
      invoke(IPC_INVOKE_CHANNELS.writeInstancePty, instanceId, source, data),
    resizeInstancePty: (instanceId, source, cols, rows) =>
      invoke(IPC_INVOKE_CHANNELS.resizeInstancePty, instanceId, source, cols, rows),
    getInstanceStats: (instanceId) => invoke(IPC_INVOKE_CHANNELS.getInstanceStats, instanceId),
    exportInstanceLogs: (instanceId, source) =>
      invoke(IPC_INVOKE_CHANNELS.exportInstanceLogs, instanceId, source),
    startInstall: (request) => invoke(IPC_INVOKE_CHANNELS.startInstall, request),
    retryInstall: (taskId) => invoke(IPC_INVOKE_CHANNELS.retryInstall, taskId),
    cancelInstall: (taskId) => invoke(IPC_INVOKE_CHANNELS.cancelInstall, taskId),
    scanInstancePlugins: (instanceId) =>
      invoke(IPC_INVOKE_CHANNELS.scanInstancePlugins, instanceId),
    scanInstancePluginConfigs: (instanceId) =>
      invoke(IPC_INVOKE_CHANNELS.scanInstancePluginConfigs, instanceId),
    exportIntegrationPack: (instanceId, options, destPath) =>
      invoke(IPC_INVOKE_CHANNELS.exportIntegrationPack, instanceId, options, destPath),
    validateIntegrationPack: (packPath) =>
      invoke(IPC_INVOKE_CHANNELS.validateIntegrationPack, packPath),
    importIntegrationPack: (request) =>
      invoke(IPC_INVOKE_CHANNELS.importIntegrationPack, request),
    manualAddInstance: (config) => invoke(IPC_INVOKE_CHANNELS.manualAddInstance, config),
    detectSystemEnv: () => invoke(IPC_INVOKE_CHANNELS.detectSystemEnv),
    listBotPlatforms: () => invoke(IPC_INVOKE_CHANNELS.listBotPlatforms),
    getSettings: () => invoke(IPC_INVOKE_CHANNELS.getSettings),
    updateSettings: (patch) => invoke(IPC_INVOKE_CHANNELS.updateSettings, patch),
    detectLegacyLauncher: () => invoke(IPC_INVOKE_CHANNELS.detectLegacyLauncher),
    previewLegacyMigration: () => invoke(IPC_INVOKE_CHANNELS.previewLegacyMigration),
    importLegacyMigration: () => invoke(IPC_INVOKE_CHANNELS.importLegacyMigration),
    oobeVerifySudo: (password) => invoke(IPC_INVOKE_CHANNELS.oobeVerifySudo, password),
    oobeInspectDependencies: () => invoke(IPC_INVOKE_CHANNELS.oobeInspectDependencies),
    oobeInstallDependencies: () => invoke(IPC_INVOKE_CHANNELS.oobeInstallDependencies),
    oobeCancelInstall: () => invoke(IPC_INVOKE_CHANNELS.oobeCancelInstall),
    oobeComplete: () => invoke(IPC_INVOKE_CHANNELS.oobeComplete),
    pickFile: (options) => invoke(IPC_INVOKE_CHANNELS.pickFile, options),
    pickDirectory: (options) => invoke(IPC_INVOKE_CHANNELS.pickDirectory, options),
    selectWallpaper: () => invoke(IPC_INVOKE_CHANNELS.selectWallpaper),
    commitWallpaper: (assetId) => invoke(IPC_INVOKE_CHANNELS.commitWallpaper, assetId),
    discardWallpaper: (assetId) => invoke(IPC_INVOKE_CHANNELS.discardWallpaper, assetId),
    removeWallpaper: () => invoke(IPC_INVOKE_CHANNELS.removeWallpaper),
    on: <K extends keyof MofoxEventMap>(
      event: K,
      listener: (payload: MofoxEventMap[K]) => void,
    ) => {
      const channel = IPC_EVENT_CHANNELS[event];
      if (!channel) throw new Error(`Unsupported IPC event: ${String(event)}`);
      // 不向渲染层泄漏 Electron 事件对象，并保留包装函数以便精确退订。
      const wrappedListener = (_event: IpcRendererEvent, payload: unknown) => {
        listener(payload as MofoxEventMap[K]);
      };
      ipc.on(channel, wrappedListener);
      return () => ipc.removeListener(channel, wrappedListener);
    },
  };
}

/** 仅在上下文隔离启用时向页面注入受限 API，避免直接暴露 Electron 能力。 */
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('mofoxAPI', createMofoxApi(ipcRenderer));
}
