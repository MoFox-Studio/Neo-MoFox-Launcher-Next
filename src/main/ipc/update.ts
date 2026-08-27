import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';
import type { MofoxUpdateInfo, PlatformUpdateInfo } from '../../shared/domain/update';

/** 实例更新 IPC 边界：只接收实例 ID 与目标分支/提交/版本，更新细节留在服务层。 */
interface UpdateActions {
  getMofoxInfo(instanceId: string): Promise<MofoxUpdateInfo>;
  switchBranch(instanceId: string, branch: string): Promise<MofoxUpdateInfo>;
  checkoutCommit(instanceId: string, commitHash: string): Promise<MofoxUpdateInfo>;
  updateMofox(instanceId: string): Promise<MofoxUpdateInfo>;
  getPlatformInfo(instanceId: string): Promise<PlatformUpdateInfo>;
  updatePlatform(instanceId: string, version: string): Promise<PlatformUpdateInfo>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册实例更新相关 IPC 通道。
 *
 * 渲染端只能指定实例 ID 与目标分支/提交/版本，分支切换、提交回退、依赖同步
 * 与平台缓存目录安全替换等实现细节全部保留在服务层内部。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的实例更新动作集合。
 */
export function registerUpdateIpc(ipcMain: IpcMainRegistrar, actions: UpdateActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.getMofoxUpdateInfo, (id) =>
    actions.getMofoxInfo(requireId(id)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.switchMofoxBranch, (id, branch) =>
    actions.switchBranch(requireId(id), requireString(branch, 'branch')),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.checkoutMofoxCommit, (id, commit) =>
    actions.checkoutCommit(requireId(id), requireString(commit, 'commitHash')),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.updateMofox, (id) => actions.updateMofox(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.getPlatformUpdateInfo, (id) =>
    actions.getPlatformInfo(requireId(id)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.updatePlatform, (id, version) =>
    actions.updatePlatform(requireId(id), requireVersion(version)),
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
 * 校验通用字符串参数，失败时抛出包含字段名的可读错误。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @param label - 用于错误信息的字段名称。
 * @returns 通过校验的字符串值。
 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', `${label} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * 校验平台目标版本：允许空字符串（表示最新发行版）或非空字符串。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 通过校验的版本字符串。
 */
function requireVersion(value: unknown): string {
  if (typeof value !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'version must be a string');
  }
  return value.trim();
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
      // 将参数校验、git 操作与文件替换错误统一为跨进程可识别的错误格式。
      throw serializeIpcError(error);
    }
  });
}
