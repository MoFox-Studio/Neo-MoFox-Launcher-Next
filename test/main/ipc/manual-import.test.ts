import { describe, expect, it, vi } from 'vitest';
import { registerManualImportIpc } from '../../../src/main/ipc/manual-import';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';

/** 验证手动导入 IPC 的通道注册、请求转发与跨进程参数校验。 */
interface IpcMainRegistrar {
  handle(channel: string, handler: (...args: unknown[]) => unknown): unknown;
}

function createIpcMain(): {
  handlers: Map<string, (...args: unknown[]) => unknown>;
  ipcMain: IpcMainRegistrar;
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain: IpcMainRegistrar = {
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
  };
  return { handlers, ipcMain };
}

describe('registerManualImportIpc', () => {
  it('registers and forwards the valid manual-import request', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = { importInstance: vi.fn(async () => ({ instanceId: 'mofox-new' })) };
    registerManualImportIpc(ipcMain, actions);

    const request = {
      instanceName: '已有实例',
      mofoxInstallDir: '/bots/neo-mofox',
      platformId: 'napcat',
      platformDir: '/bots/napcat',
    };
    const result = await handlers.get(IPC_INVOKE_CHANNELS.manualImportInstance)?.({}, request);

    expect([...handlers.keys()]).toEqual([IPC_INVOKE_CHANNELS.manualImportInstance]);
    expect(actions.importInstance).toHaveBeenCalledWith(request);
    expect(result).toEqual({ instanceId: 'mofox-new' });
  });

  it('rejects the removed MoFox version field before calling the service', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = { importInstance: vi.fn() };
    registerManualImportIpc(ipcMain, actions);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.manualImportInstance)?.(
        {},
        { instanceName: '已有实例', mofoxInstallDir: '/bots/neo-mofox', version: '0.9.5' },
      ),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.importInstance).not.toHaveBeenCalled();
  });

  it('rejects malformed or extra manual-import arguments before calling the service', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = { importInstance: vi.fn() };
    registerManualImportIpc(ipcMain, actions);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.manualImportInstance)?.({}, { instanceName: 'only name' }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.manualImportInstance)?.(
        {},
        { instanceName: 'name', mofoxInstallDir: '/bots/neo-mofox' },
        'extra',
      ),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.importInstance).not.toHaveBeenCalled();
  });
});
