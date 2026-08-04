import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerOobeIpc } from '../../../src/main/ipc/oobe';

/** 验证 OOBE IPC 通道注册、参数转发、密码校验与服务异常的稳定序列化。 */
interface IpcMainRegistrar {
  handle(channel: string, handler: (...args: unknown[]) => unknown): unknown;
}

function createIpcMain(): { handlers: Map<string, (...args: unknown[]) => unknown>; ipcMain: IpcMainRegistrar } {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain: IpcMainRegistrar = {
    handle: (channel, handler) => handlers.set(channel, handler),
  };
  return { handlers, ipcMain };
}

function createActions() {
  return {
    verifySudoPassword: vi.fn(async () => true),
    installDependencies: vi.fn(async () => []),
    cancel: vi.fn(async () => undefined),
    complete: vi.fn(async () => ({ completed: true, dependencies: [], legacy: null })),
  };
}

describe('registerOobeIpc', () => {
  it('registers the four OOBE channels', () => {
    const { handlers, ipcMain } = createIpcMain();
    registerOobeIpc(ipcMain, createActions());

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.oobeVerifySudo,
      IPC_INVOKE_CHANNELS.oobeInstallDependencies,
      IPC_INVOKE_CHANNELS.oobeCancelInstall,
      IPC_INVOKE_CHANNELS.oobeComplete,
    ]);
  });

  it('forwards sudo password to the service', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerOobeIpc(ipcMain, actions);

    await handlers.get(IPC_INVOKE_CHANNELS.oobeVerifySudo)?.({}, 'sudo-password');

    expect(actions.verifySudoPassword).toHaveBeenCalledWith('sudo-password');
  });

  it('rejects non-string or empty sudo passwords before calling the service', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerOobeIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.oobeVerifySudo)?.({}, '')).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(handlers.get(IPC_INVOKE_CHANNELS.oobeVerifySudo)?.({}, 123)).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    expect(actions.verifySudoPassword).not.toHaveBeenCalled();
  });

  it('serializes service failures into stable IPC errors', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    actions.installDependencies.mockRejectedValueOnce(
      Object.assign(new Error('winget 不可用'), { code: 'IO_ERROR' }),
    );
    registerOobeIpc(ipcMain, actions);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.oobeInstallDependencies)?.({}),
    ).rejects.toThrow('MOFOX_ERROR:');
  });
});
