import { serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';
import type {
  LauncherBuildInfo,
  LauncherReleaseNotes,
  LauncherUpdateInfo,
} from '../../shared/domain/app-update';

/** 启动器更新 IPC 边界：渲染端只能读取构建信息、发行说明或触发一次远端检查，无额外参数。 */
interface LauncherUpdateActions {
  getBuildInfo(): Promise<LauncherBuildInfo>;
  check(): Promise<LauncherUpdateInfo>;
  getReleaseNotes(): Promise<LauncherReleaseNotes>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册启动器自身更新相关 IPC 通道。
 *
 * 两个通道都不接收渲染端参数，版本比较、镜像轮询与发行说明获取的细节全部保留在服务层。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的启动器更新动作集合。
 */
export function registerLauncherUpdateIpc(
  ipcMain: IpcMainRegistrar,
  actions: LauncherUpdateActions,
): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.getLauncherBuildInfo, () => actions.getBuildInfo());
  register(ipcMain, IPC_INVOKE_CHANNELS.checkLauncherUpdate, () => actions.check());
  register(ipcMain, IPC_INVOKE_CHANNELS.getLauncherReleaseNotes, () => actions.getReleaseNotes());
}

/**
 * 在指定通道上注册 IPC 处理器，统一捕获并序列化异常为跨进程错误协议。
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
      // 将镜像轮询与网络错误统一为跨进程可识别的错误格式。
      throw serializeIpcError(error);
    }
  });
}
