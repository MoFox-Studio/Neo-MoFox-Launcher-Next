import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import type { ManualImportRequest, ManualImportResult } from '../../shared/domain/manual-import';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 手动导入 IPC 仅暴露将已有目录注册为实例的单一动作。 */
interface ManualImportActions {
  importInstance(request: ManualImportRequest): Promise<ManualImportResult>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册手动导入 IPC，并在跨进程边界校验请求形状。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 手动导入服务。
 */
export function registerManualImportIpc(
  ipcMain: IpcMainRegistrar,
  actions: ManualImportActions,
): void {
  ipcMain.handle(IPC_INVOKE_CHANNELS.manualImportInstance, async (_event, ...args) => {
    try {
      if (args.length !== 1) {
        throw new MofoxError(
          'INVALID_ARGUMENT',
          'Manual import channel takes one request argument',
        );
      }
      return await actions.importInstance(requireRequest(args[0]));
    } catch (error) {
      throw serializeIpcError(error);
    }
  });
}

/** 校验基本字段形状；目录存在性和业务冲突由服务层负责。 */
function requireRequest(value: unknown): ManualImportRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Manual import request must be an object');
  }
  const request = value as Partial<ManualImportRequest>;
  if (typeof request.instanceName !== 'string' || typeof request.mofoxInstallDir !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'Instance name and Neo-MoFox directory are required');
  }
  for (const field of ['version', 'platformId', 'platformDir'] as const) {
    if (request[field] !== undefined && typeof request[field] !== 'string') {
      throw new MofoxError('INVALID_ARGUMENT', `${field} must be a string`);
    }
  }
  return request as ManualImportRequest;
}
