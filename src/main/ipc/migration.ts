import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';
import type {
  LegacyLauncherInfo,
  MigrationPreview,
  MigrationResult,
} from '../../shared/domain/migration';

/** 迁移 IPC 边界：渲染端只能触发检测、预览与导入三种动作，路径解析与文件 IO 留在服务层。 */
interface MigrationServices {
  detect(): Promise<LegacyLauncherInfo | null>;
  preview(): Promise<MigrationPreview>;
  importInstances(): Promise<MigrationResult>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册旧启动器迁移相关 IPC 通道。
 *
 * 检测、预览与导入三种动作均不接受渲染端参数，路径解析与文件 IO 全部留在服务层。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param services - 暴露给渲染端的迁移服务接口。
 */
export function registerMigrationIpc(ipcMain: IpcMainRegistrar, services: MigrationServices): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.detectLegacyLauncher, () => services.detect());
  register(ipcMain, IPC_INVOKE_CHANNELS.previewLegacyMigration, () => services.preview());
  register(ipcMain, IPC_INVOKE_CHANNELS.importLegacyMigration, () => services.importInstances());
}

/**
 * 在指定通道上注册 IPC 处理器，强制拒绝任何载荷并统一序列化异常。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param channel - 需要监听的 IPC 通道名。
 * @param handler - 实际业务处理函数，迁移通道均无入参。
 */
function register(
  ipcMain: IpcMainRegistrar,
  channel: string,
  handler: (...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      // 检测/预览/导入均无入参；显式拒绝任何载荷以保持通道契约。
      if (args.length > 0) {
        throw new MofoxError('INVALID_ARGUMENT', 'Migration channel takes no arguments');
      }
      return await handler(...args);
    } catch (error) {
      // 迁移过程中的 NOT_FOUND、IO_ERROR 等业务异常统一序列化后回传渲染层。
      throw serializeIpcError(error);
    }
  });
}
