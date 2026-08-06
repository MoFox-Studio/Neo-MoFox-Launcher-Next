import type { InstallRequest } from '../../shared/domain/install';
import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 安装任务 IPC 边界：只接受结构正确的请求和任务标识，服务层负责后续路径与生命周期校验。 */
interface InstallActions {
  start(request: InstallRequest): Promise<string>;
  retry(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册安装任务相关 IPC 通道。
 *
 * 在跨进程边界处校验请求体与任务 ID 的基本形状，再委托给安装服务执行实际状态机迁移。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的安装任务动作集合（start/retry/cancel）。
 */
export function registerInstallIpc(ipcMain: IpcMainRegistrar, actions: InstallActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.startInstall, (request) =>
    actions.start(requireRequest(request)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.retryInstall, (taskId) => actions.retry(requireId(taskId)));
  register(ipcMain, IPC_INVOKE_CHANNELS.cancelInstall, (taskId) =>
    actions.cancel(requireId(taskId)),
  );
}

/**
 * 校验来自渲染端的安装请求载荷并归一化为 InstallRequest。
 *
 * 仅检查关键字段是否为字符串且非空；字段语义与路径合法性由服务层进一步校验。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 形态合法的安装请求对象。
 */
function requireRequest(value: unknown): InstallRequest {
  // 不可信 invoke 载荷先校验对象形状，避免将 null、数组等值传入安装状态机。
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Install request must be an object');
  }
  const request = value as Partial<InstallRequest>;
  if (
    typeof request.instanceName !== 'string' ||
    typeof request.platformId !== 'string' ||
    typeof request.version !== 'string' ||
    typeof request.targetDir !== 'string'
  ) {
    throw new MofoxError('INVALID_ARGUMENT', 'Install request fields are invalid');
  }
  return request as InstallRequest;
}

/**
 * 校验任务 ID 字符串，确保服务层不会因空值产生歧义。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 去除首尾空白后的任务 ID。
 */
function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new MofoxError('INVALID_ARGUMENT', 'Task ID is required');
  return value;
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
    // 对取消、冲突和安装失败使用统一错误协议，避免泄露主进程异常对象。
    try {
      return await handler(...args);
    } catch (error) {
      throw serializeIpcError(error);
    }
  });
}
