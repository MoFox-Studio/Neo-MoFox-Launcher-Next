import type { LauncherSettings } from '../../shared/domain/settings';
import type { WallpaperAsset } from '../../shared/domain/wallpaper';
import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

interface WallpaperActions {
  /** 打开受控文件对话框并暂存用户选择的媒体；取消时返回 null。 */
  selectAndStage(): Promise<WallpaperAsset | null>;
  /** 将已通过取色验证的暂存媒体提升为当前壁纸。 */
  commit(id: string): Promise<LauncherSettings>;
  /** 丢弃未提交的暂存媒体。 */
  discard(id: string): Promise<void>;
  /** 删除当前壁纸及其显示设置。 */
  remove(): Promise<LauncherSettings>;
}

/** 可由 Electron `ipcMain` 或单元测试替身实现的最小注册接口。 */
interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册壁纸暂存、提交与删除 IPC，避免设置补丁直接接收本地路径。
 *
 * @param ipcMain - Electron IPC 注册器或测试替身。
 * @param actions - 受信任主进程壁纸操作集合。
 */
export function registerWallpaperIpc(ipcMain: IpcMainRegistrar, actions: WallpaperActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.selectWallpaper, () => actions.selectAndStage());
  register(ipcMain, IPC_INVOKE_CHANNELS.commitWallpaper, (id) => actions.commit(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.discardWallpaper, (id) => actions.discard(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.removeWallpaper, () => actions.remove());
}

/** 验证 UUID 格式的暂存资产标识，阻止任意值进入服务层。 */
function requireId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Wallpaper asset ID is invalid');
  }
  return value;
}

/** 将业务异常编码为稳定的跨进程错误协议。 */
function register(
  ipcMain: IpcMainRegistrar,
  channel: string,
  handler: (...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      throw serializeIpcError(error);
    }
  });
}
