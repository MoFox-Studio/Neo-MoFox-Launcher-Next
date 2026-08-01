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

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
  }
  return value;
}

function requireSource(value: unknown): InstanceProcessSource {
  // 进程源是日志、终端和状态同步的分区键，禁止任意字符串穿透到运行时 Map。
  if (value !== 'mofox' && value !== 'platform') {
    throw new MofoxError('INVALID_ARGUMENT', 'Process source must be "mofox" or "platform"');
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new MofoxError('INVALID_ARGUMENT', `${label} must be a string`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MofoxError('INVALID_ARGUMENT', `${label} must be a number`);
  }
  return value;
}

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
