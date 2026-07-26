import type { InstallRequest } from '../../shared/domain/instance';
import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

interface InstallActions {
  start(request: InstallRequest): Promise<string>;
  retry(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

export function registerInstallIpc(ipcMain: IpcMainRegistrar, actions: InstallActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.startInstall, (request) => actions.start(requireRequest(request)));
  register(ipcMain, IPC_INVOKE_CHANNELS.retryInstall, (taskId) => actions.retry(requireId(taskId)));
  register(ipcMain, IPC_INVOKE_CHANNELS.cancelInstall, (taskId) => actions.cancel(requireId(taskId)));
}

function requireRequest(value: unknown): InstallRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Install request must be an object');
  }
  const request = value as Partial<InstallRequest>;
  if (typeof request.instanceName !== 'string' || typeof request.platformId !== 'string' || typeof request.version !== 'string' || typeof request.targetDir !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'Install request fields are invalid');
  }
  return request as InstallRequest;
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Task ID is required');
  return value;
}

function register(ipcMain: IpcMainRegistrar, channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try { return await handler(...args); } catch (error) { throw serializeIpcError(error); }
  });
}