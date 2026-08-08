import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';
import type { InstanceProcessSource, InstanceStats } from '../../shared/domain/instance';

/** 实例控制 IPC 边界：渲染端只能操作明确的实例 ID、进程源和 PTY 参数，运行时细节留在服务层。 */
interface InstanceActions {
  start(instanceId: string): Promise<void>;
  stop(instanceId: string): Promise<void>;
  restart(instanceId: string): Promise<void>;
  remove(instanceId: string): Promise<void>;
  openFolder(instanceId: string): Promise<void>;
  getLogBuffer(instanceId: string, source: InstanceProcessSource): string;
  clearLogBuffer(instanceId: string, source: InstanceProcessSource): void;
  writePty(instanceId: string, source: InstanceProcessSource, data: string): void;
  resizePty(instanceId: string, source: InstanceProcessSource, cols: number, rows: number): void;
  getStats(instanceId: string): InstanceStats;
  exportLogs(instanceId: string, source: InstanceProcessSource): Promise<string>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册实例控制相关 IPC 通道。
 *
 * 渲染端只能操作明确的实例 ID、进程源和 PTY 参数；所有运行时细节保留在服务层内部。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param instances - 暴露给渲染端的实例控制动作集合。
 */
export function registerInstanceIpc(ipcMain: IpcMainRegistrar, instances: InstanceActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.startInstance, (id) => instances.start(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.stopInstance, (id) => instances.stop(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.restartInstance, (id) => instances.restart(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.removeInstance, (id) => instances.remove(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.openInstanceFolder, (id) => instances.openFolder(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.getInstanceLogBuffer, (id, source) =>
    instances.getLogBuffer(requireId(id), requireSource(source)));
  register(ipcMain, IPC_INVOKE_CHANNELS.clearInstanceLogBuffer, (id, source) =>
    instances.clearLogBuffer(requireId(id), requireSource(source)));
  register(ipcMain, IPC_INVOKE_CHANNELS.writeInstancePty, (id, source, data) =>
    instances.writePty(requireId(id), requireSource(source), requireString(data, 'PTY data')));
  register(ipcMain, IPC_INVOKE_CHANNELS.resizeInstancePty, (id, source, cols, rows) =>
    instances.resizePty(requireId(id), requireSource(source), requireNumber(cols, 'cols'), requireNumber(rows, 'rows')));
  register(ipcMain, IPC_INVOKE_CHANNELS.getInstanceStats, (id) => instances.getStats(requireId(id)));
  register(ipcMain, IPC_INVOKE_CHANNELS.exportInstanceLogs, (id, source) =>
    instances.exportLogs(requireId(id), requireSource(source)));
}

/**
 * 校验实例 ID 字符串，避免空值进入运行时 Map 查询。
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
 * 校验进程源枚举值，禁止任意字符串作为日志和终端的分区键。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 通过校验的进程源标识（`mofox` 或 `platform`）。
 */
function requireSource(value: unknown): InstanceProcessSource {
  // 进程源是日志、终端和状态同步的分区键，禁止任意字符串穿透到运行时 Map。
  if (value !== 'mofox' && value !== 'platform') {
    throw new MofoxError('INVALID_ARGUMENT', 'Process source must be "mofox" or "platform"');
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
  if (typeof value !== 'string') throw new MofoxError('INVALID_ARGUMENT', `${label} must be a string`);
  return value;
}

/**
 * 校验有限数值参数，用于 PTY 列高与数值类入参。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @param label - 用于错误信息的字段名称。
 * @returns 通过校验的数值。
 */
function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MofoxError('INVALID_ARGUMENT', `${label} must be a number`);
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
      // 将参数校验、文件操作和进程生命周期错误统一为跨进程可识别的错误格式。
      throw serializeIpcError(error);
    }
  });
}
