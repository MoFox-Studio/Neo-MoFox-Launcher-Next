import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import type { InstanceTerminalDirKind } from '../../shared/domain/instance';
import type { TerminalShellOption } from '../../shared/domain/terminal-shell';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 打开终端会话的可选参数。 */
export interface TerminalOpenOptions {
  shellId?: string;
  size?: { cols: number; rows: number };
}

/** 实例终端 IPC 边界：渲染端只能对明确的实例执行打开、写入、调整与关闭动作。 */
export interface InstanceTerminalActions {
  listShells(): Promise<TerminalShellOption[]>;
  open(
    instanceId: string,
    kind: InstanceTerminalDirKind,
    options?: TerminalOpenOptions,
  ): Promise<{ cwd: string }>;
  write(instanceId: string, data: string): void;
  resize(instanceId: string, cols: number, rows: number): void;
  close(instanceId: string): Promise<void>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册实例终端相关 IPC 通道。
 *
 * 目录种类与尺寸在边界处校验；会话生命周期细节保留在服务层内部。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的终端动作集合。
 */
export function registerInstanceTerminalIpc(
  ipcMain: IpcMainRegistrar,
  actions: InstanceTerminalActions,
): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.listInstanceTerminalShells, () => actions.listShells());
  register(ipcMain, IPC_INVOKE_CHANNELS.openInstanceTerminal, (id, kind, options) =>
    actions.open(requireId(id), requireKind(kind), requireOptionalOptions(options)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.writeInstanceTerminal, (id, data) =>
    actions.write(requireId(id), requireString(data, 'PTY data')),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.resizeInstanceTerminal, (id, cols, rows) =>
    actions.resize(requireId(id), requireNumber(cols, 'cols'), requireNumber(rows, 'rows')),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.closeInstanceTerminal, (id) =>
    actions.close(requireId(id)),
  );
}

/** 校验实例 ID 字符串，空值抛出 `INVALID_ARGUMENT`。 */
function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
  }
  return value;
}

/**
 * 校验终端工作目录种类，禁止任意字符串作为目录解析分支。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 通过校验的目录种类。
 */
function requireKind(value: unknown): InstanceTerminalDirKind {
  if (value !== 'mofox' && value !== 'venv' && value !== 'platform') {
    throw new MofoxError(
      'INVALID_ARGUMENT',
      'Terminal directory kind must be "mofox", "venv" or "platform"',
    );
  }
  return value;
}

/** 校验必填字符串参数。 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', `${label} must be a string`);
  }
  return value;
}

/** 校验有限数值参数，用于 PTY 列高。 */
function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MofoxError('INVALID_ARGUMENT', `${label} must be a number`);
  }
  return value;
}

/** 校验可选的打开参数对象；`undefined` 透传。 */
function requireOptionalOptions(value: unknown): TerminalOpenOptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new MofoxError('INVALID_ARGUMENT', 'Terminal options must be an object');
  }
  const { shellId, size } = value as { shellId?: unknown; size?: unknown };
  return {
    ...(shellId !== undefined
      ? { shellId: requireOptionalText(shellId, 'Terminal shell ID') }
      : {}),
    ...(size !== undefined ? { size: requireOptionalSize(size) } : {}),
  };
}

/** 校验可选字符串参数；`undefined` 透传，空串视作缺省。 */
function requireOptionalText(value: unknown, label: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', `${label} must be a string`);
  }
  return value.trim();
}

/** 校验可选的终端尺寸对象；`undefined` 透传。 */
function requireOptionalSize(value: unknown): { cols: number; rows: number } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new MofoxError('INVALID_ARGUMENT', 'Terminal size must be an object');
  }
  const size = value as { cols?: unknown; rows?: unknown };
  return {
    cols: requireNumber(size.cols, 'cols'),
    rows: requireNumber(size.rows, 'rows'),
  };
}

/** 在指定通道上注册 IPC 处理器，统一捕获并序列化异常为跨进程错误协议。 */
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
