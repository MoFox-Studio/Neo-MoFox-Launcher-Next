import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 系统外壳操作边界：仅暴露渲染进程需要的打开外部链接能力。 */
interface ShellActions {
  openExternal(url: string): Promise<void>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册外壳相关 IPC 通道。
 *
 * 在跨进程边界处校验 URL 必须是安全的 http(s) 链接，再委托给适配器调用系统浏览器。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的外壳动作集合。
 */
export function registerShellIpc(ipcMain: IpcMainRegistrar, actions: ShellActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.openExternal, (url) =>
    actions.openExternal(requireHttpUrl(url)),
  );
}

/**
 * 校验来自渲染端的外部链接并归一化为字符串。
 *
 * 只允许 http/https 协议，避免把任意协议交给系统默认处理器。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 校验通过的链接地址。
 */
function requireHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'External URL is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MofoxError('INVALID_ARGUMENT', 'External URL is invalid');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new MofoxError('INVALID_ARGUMENT', 'Only http(s) URLs are allowed');
  }
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
    try {
      return await handler(...args);
    } catch (error) {
      throw serializeIpcError(error);
    }
  });
}
