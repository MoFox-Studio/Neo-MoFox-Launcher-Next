import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';
import type { LegacyLauncherInfo, MigrationPreview, MigrationResult } from '../../shared/domain/instance';

/** 迁移 IPC 边界：渲染端只能触发检测、预览与导入三种动作，路径解析与文件 IO 留在服务层。 */
interface MigrationServices {
  detect(): Promise<LegacyLauncherInfo | null>;
  preview(): Promise<MigrationPreview>;
  importInstances(): Promise<MigrationResult>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

export function registerMigrationIpc(ipcMain: IpcMainRegistrar, services: MigrationServices): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.detectLegacyLauncher, () => services.detect());
  register(ipcMain, IPC_INVOKE_CHANNELS.previewLegacyMigration, () => services.preview());
  register(ipcMain, IPC_INVOKE_CHANNELS.importLegacyMigration, () => services.importInstances());
}

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
