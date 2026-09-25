import type { LauncherSettings } from '../../shared/domain/settings';
import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import type { SystemEnvInfo } from '../../shared/domain/system-env';
import type { BotPlatformMetadata } from '../../shared/domain/bot-platform';
import type { Instance } from '../../shared/domain/instance';
import { IPC_INVOKE_CHANNELS, type DataFileKind } from '../../shared/ipc';

/** 核心查询与设置 IPC 注册层：校验来自 preload 的参数，并将服务异常收敛为稳定的 IPC 错误协议。 */
interface CoreServices {
  instances: { list(): Promise<Instance[]> };
  environment: { detect(): Promise<SystemEnvInfo> };
  platforms: { list(): BotPlatformMetadata[] };
  settings: {
    get(): Promise<LauncherSettings>;
    update(patch: unknown): Promise<LauncherSettings>;
  };
  appearance: {
    getSystemAccentColor(): string | null;
  };
  dataFiles: {
    open(kind: DataFileKind): Promise<void>;
  };
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册核心查询与设置类 IPC 通道。
 *
 * 将渲染端不可信载荷交由服务层校验，并将领域异常统一序列化以维持稳定的 IPC 合约。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param services - 暴露给渲染端的核心服务集合（实例列表、环境检测、平台元数据、设置）。
 */
export function registerCoreIpc(ipcMain: IpcMainRegistrar, services: CoreServices): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.listInstances, () => services.instances.list());
  register(ipcMain, IPC_INVOKE_CHANNELS.detectSystemEnv, () => services.environment.detect());
  register(ipcMain, IPC_INVOKE_CHANNELS.listBotPlatforms, () => services.platforms.list());
  register(ipcMain, IPC_INVOKE_CHANNELS.getSettings, () => services.settings.get());
  register(ipcMain, IPC_INVOKE_CHANNELS.updateSettings, (patch) => {
    // 设置服务会做字段级校验；这里先阻断非对象跨进程输入。
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new MofoxError('INVALID_ARGUMENT', 'Settings patch must be an object');
    }
    return services.settings.update(patch);
  });
  register(ipcMain, IPC_INVOKE_CHANNELS.getSystemAccentColor, () =>
    services.appearance.getSystemAccentColor(),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.openDataFile, (kind) =>
    services.dataFiles.open(requireDataFileKind(kind)),
  );
}

/**
 * 在指定通道上注册 IPC 处理器，统一捕获异常并序列化为跨进程错误协议。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param channel - 需要监听的 IPC 通道名。
 * @param handler - 实际业务处理函数，参数来自渲染端 invoke 调用。
 */
function register(
  ipcMain: IpcMainRegistrar,
  channel: string,
  handler: (...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      // Electron invoke 不直接暴露领域异常，统一序列化以保持 preload/renderer 合约稳定。
      throw serializeIpcError(error);
    }
  });
}

/**
 * 校验渲染端请求的数据源文件符号名。
 *
 * 渲染端只允许传递白名单内的符号名，真实路径一律由主进程解析，避免任意路径打开能力外泄。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 校验通过的数据文件种类。
 */
function requireDataFileKind(value: unknown): DataFileKind {
  if (value !== 'settings' && value !== 'instances') {
    throw new MofoxError('INVALID_ARGUMENT', 'Unknown data file kind');
  }
  return value;
}
