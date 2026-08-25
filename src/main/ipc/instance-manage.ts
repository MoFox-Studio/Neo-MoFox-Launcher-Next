import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import type { Instance, UpdateInstancePatch } from '../../shared/domain/instance';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 实例管理 IPC 边界：只暴露删除、打开安装目录与更新配置，进程控制留在运行时 IPC。 */
interface InstanceManageActions {
  remove(instanceId: string): Promise<void>;
  openFolder(instanceId: string): Promise<void>;
  update(instanceId: string, patch: UpdateInstancePatch): Promise<Instance>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册实例管理相关 IPC 通道。
 *
 * 管理动作与进程控制分离：渲染端只能通过本模块执行删除、打开目录和更新配置，
 * 运行时细节保留在服务层内部。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的实例管理动作集合。
 */
export function registerInstanceManageIpc(
  ipcMain: IpcMainRegistrar,
  actions: InstanceManageActions,
): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.removeInstance, (id) => actions.remove(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.openInstanceFolder, (id) =>
    actions.openFolder(requireId(id)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.updateInstance, (id, patch) =>
    actions.update(requireId(id), requirePatch(patch)),
  );
}

/**
 * 校验实例 ID 字符串，避免空值进入服务层查询。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 去除首尾空白后的实例 ID。
 */
function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
  }
  return value;
}

/**
 * 校验更新补丁的形状，禁止任意对象或未知字段穿透到持久化层。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 通过校验的实例更新补丁。
 */
function requirePatch(value: unknown): UpdateInstancePatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Update patch must be an object');
  }
  const patch = value as Record<string, unknown>;
  if (patch.name !== undefined && typeof patch.name !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'name must be a string');
  }
  if (patch.mofoxInstallDir !== undefined && typeof patch.mofoxInstallDir !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'mofoxInstallDir must be a string');
  }
  if (patch.autoStart !== undefined && typeof patch.autoStart !== 'boolean') {
    throw new MofoxError('INVALID_ARGUMENT', 'autoStart must be a boolean');
  }
  if (patch.platform !== undefined) {
    if (patch.platform === null) return patch as UpdateInstancePatch;
    if (typeof patch.platform !== 'object' || Array.isArray(patch.platform)) {
      throw new MofoxError('INVALID_ARGUMENT', 'platform must be an object or null');
    }
    const platform = patch.platform as Record<string, unknown>;
    for (const field of ['id', 'installDir', 'version'] as const) {
      if (
        platform[field] !== undefined &&
        platform[field] !== null &&
        typeof platform[field] !== 'string'
      ) {
        throw new MofoxError('INVALID_ARGUMENT', `platform.${field} must be a string or null`);
      }
    }
  }
  return patch as UpdateInstancePatch;
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
      // 将参数校验、文件操作和更新持久化错误统一为跨进程可识别的错误格式。
      throw serializeIpcError(error);
    }
  });
}
