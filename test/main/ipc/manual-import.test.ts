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
  it('registers manual-import channels and forwards the valid request', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = {
      importInstance: vi.fn(async () => ({ instanceId: 'mofox-new' })),
      inspectImportPath: vi.fn(async () => ({
        absolute: true,
        exists: true,
        isDirectory: true,
        mainPyExists: true,
      })),
      inspectPlatformPath: vi.fn(async () => ({
        absolute: true,
        exists: true,
        isDirectory: true,
        valid: true,
      })),
    };
    registerManualImportIpc(ipcMain, actions);

    const request = {
      instanceName: '已有实例',
      mofoxInstallDir: '/bots/neo-mofox',
      platformId: 'napcat',
      platformDir: '/bots/napcat',
    };
    const result = await handlers.get(IPC_INVOKE_CHANNELS.manualImportInstance)?.({}, request);

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.manualImportInstance,
      IPC_INVOKE_CHANNELS.inspectImportPath,
      IPC_INVOKE_CHANNELS.inspectPlatformImportPath,
    ]);
    expect(actions.importInstance).toHaveBeenCalledWith(request);
    expect(result).toEqual({ instanceId: 'mofox-new' });
  });

  it('forwards path inspection to the service action', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = {
      importInstance: vi.fn(),
      inspectImportPath: vi.fn(async () => ({
        absolute: false,
        exists: false,
        isDirectory: false,
        mainPyExists: false,
      })),
      inspectPlatformPath: vi.fn(),
    };
    registerManualImportIpc(ipcMain, actions);

    const result = await handlers
      .get(IPC_INVOKE_CHANNELS.inspectImportPath)
      ?.({}, '/bots/neo-mofox');

    expect(actions.inspectImportPath).toHaveBeenCalledWith('/bots/neo-mofox');
    expect(result).toEqual({
      absolute: false,
      exists: false,
      isDirectory: false,
      mainPyExists: false,
    });
  });

  it('forwards platform path inspection with the selected platform id', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = {
      importInstance: vi.fn(),
      inspectImportPath: vi.fn(),
      inspectPlatformPath: vi.fn(async () => ({
        absolute: true,
        exists: true,
        isDirectory: true,
        valid: true,
      })),
    };
    registerManualImportIpc(ipcMain, actions);

    const result = await handlers
      .get(IPC_INVOKE_CHANNELS.inspectPlatformImportPath)
      ?.({}, 'napcat', '/bots/napcat');

    expect(actions.inspectPlatformPath).toHaveBeenCalledWith('napcat', '/bots/napcat');
    expect(result).toEqual({ absolute: true, exists: true, isDirectory: true, valid: true });
  });

  it('rejects malformed inspection arguments before calling the service', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = {
      importInstance: vi.fn(),
      inspectImportPath: vi.fn(),
      inspectPlatformPath: vi.fn(),
    };
    registerManualImportIpc(ipcMain, actions);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.inspectImportPath)?.(null),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.inspectImportPath)?.(null, 42),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.inspectImportPath).not.toHaveBeenCalled();
  });

  it('rejects malformed platform inspection arguments before calling the service', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = {
      importInstance: vi.fn(),
      inspectImportPath: vi.fn(),
      inspectPlatformPath: vi.fn(),
    };
    registerManualImportIpc(ipcMain, actions);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.inspectPlatformImportPath)?.(null),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.inspectPlatformImportPath)?.({}, 'napcat'),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.inspectPlatformPath).not.toHaveBeenCalled();
  });

  it('rejects the removed MoFox version field before calling the service', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = {
      importInstance: vi.fn(),
      inspectImportPath: vi.fn(),
      inspectPlatformPath: vi.fn(),
    };
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
    const actions = {
      importInstance: vi.fn(),
      inspectImportPath: vi.fn(),
      inspectPlatformPath: vi.fn(),
    };
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
