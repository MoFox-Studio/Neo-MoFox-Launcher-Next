import type { LauncherSettings } from '../../shared/domain/instance';
import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import type { SystemEnvInfo } from '../../shared/domain/system-env';
import type { MirrorSelection, MirrorSource } from '../../shared/domain/mirror';
import type { BotPlatformMetadata } from '../../shared/domain/bot-platform';
import type { Instance } from '../../shared/domain/instance';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 核心查询与设置 IPC 注册层：校验来自 preload 的参数，并将服务异常收敛为稳定的 IPC 错误协议。 */
interface CoreServices {
  instances: { list(): Promise<Instance[]> };
  environment: { detect(): Promise<SystemEnvInfo> };
  mirrors: { list(): Promise<MirrorSource[]>; selectBest(): Promise<MirrorSelection> };
  platforms: { list(): BotPlatformMetadata[] };
  settings: {
    get(): Promise<LauncherSettings>;
    update(patch: unknown): Promise<LauncherSettings>;
  };
}

interface IpcMainRegistrar {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): unknown;
}

export function registerCoreIpc(ipcMain: IpcMainRegistrar, services: CoreServices): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.listInstances, () => services.instances.list());
  register(ipcMain, IPC_INVOKE_CHANNELS.detectSystemEnv, () => services.environment.detect());
  register(ipcMain, IPC_INVOKE_CHANNELS.listMirrors, () => services.mirrors.list());
  register(ipcMain, IPC_INVOKE_CHANNELS.selectBestMirror, () => services.mirrors.selectBest());
  register(ipcMain, IPC_INVOKE_CHANNELS.listBotPlatforms, () => services.platforms.list());
  register(ipcMain, IPC_INVOKE_CHANNELS.getSettings, () => services.settings.get());
  register(ipcMain, IPC_INVOKE_CHANNELS.updateSettings, (patch) => {
    // 设置服务会做字段级校验；这里先阻断非对象跨进程输入。
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new MofoxError('INVALID_ARGUMENT', 'Settings patch must be an object');
    }
    return services.settings.update(patch);
  });
}

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
