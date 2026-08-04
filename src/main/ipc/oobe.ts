import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';
import type { OobeCompletionSummary, OobeDependencyStatus } from '../../shared/domain/oobe';

/** OOBE IPC 边界：仅暴露 sudo 验证、依赖安装与完成动作，工作目录与临时文件留在服务层。 */
interface OobeActions {
  verifySudoPassword(password: string): Promise<boolean>;
  installDependencies(): Promise<OobeDependencyStatus[]>;
  cancel(): Promise<void>;
  complete(): Promise<OobeCompletionSummary>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册 OOBE 相关 IPC 通道。
 *
 * sudo 密码校验后由服务层在内存中保留以供安装使用；安装与完成动作均不接受渲染端参数。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的 OOBE 动作集合。
 */
export function registerOobeIpc(ipcMain: IpcMainRegistrar, actions: OobeActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.oobeVerifySudo, (password) =>
    actions.verifySudoPassword(requirePassword(password)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.oobeInstallDependencies, () =>
    actions.installDependencies(),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.oobeCancelInstall, () => actions.cancel());
  register(ipcMain, IPC_INVOKE_CHANNELS.oobeComplete, () => actions.complete());
}

/**
 * 校验 sudo 密码载荷：必须是非空字符串。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 通过校验的密码字符串。
 */
function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new MofoxError('INVALID_ARGUMENT', 'Sudo password must be a non-empty string');
  }
  return value;
}

/**
 * 在指定通道上注册 IPC 处理器，统一捕获异常并序列化为跨进程错误协议。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param channel - 需要监听的 IPC 通道名。
 * @param handler - 实际业务处理函数。
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
      // 安装失败、取消或密码错误统一序列化为 IPC 错误协议。
      throw serializeIpcError(error);
    }
  });
}
