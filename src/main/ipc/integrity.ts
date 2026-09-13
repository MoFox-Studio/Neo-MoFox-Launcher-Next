import { serializeIpcError } from '../../shared/domain/error';
import type { InstanceIntegrityIssue } from '../../shared/domain/instance';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 实例完整性检查 IPC 边界：只暴露一次性启动校验查询，删除与保留由实例管理通道负责。 */
interface IntegrityActions {
  check(): Promise<InstanceIntegrityIssue[]>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册实例完整性检查 IPC 通道。
 *
 * 渲染进程在启动完成后调用一次，主进程据此核验全部实例的磁盘文件并返回缺失项列表。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的完整性检查动作集合。
 */
export function registerIntegrityIpc(ipcMain: IpcMainRegistrar, actions: IntegrityActions): void {
  ipcMain.handle(IPC_INVOKE_CHANNELS.checkInstancesIntegrity, async () => {
    try {
      return await actions.check();
    } catch (error) {
      // 将文件系统与平台入口探测错误统一为跨进程可识别的错误格式。
      throw serializeIpcError(error);
    }
  });
}
