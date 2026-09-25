import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerCommonIpc } from '../../../src/main/ipc/common';

/** 验证通用对话框 IPC 的通道注册、选项校验、参数转发与异常序列化。 */
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

function createActions() {
  return {
    pickFile: vi.fn(async () => ['/tmp/a.txt'] as string[]),
    pickDirectory: vi.fn(async () => '/tmp/selected'),
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
    openExternal: vi.fn(async () => undefined),
  };
}

describe('registerCommonIpc', () => {
  it('registers the five service channels', () => {
    const { handlers, ipcMain } = createIpcMain();
    registerCommonIpc(ipcMain, createActions());

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.pickFile,
      IPC_INVOKE_CHANNELS.pickDirectory,
      IPC_INVOKE_CHANNELS.inspectImportPath,
      IPC_INVOKE_CHANNELS.inspectPlatformImportPath,
      IPC_INVOKE_CHANNELS.openExternal,
    ]);
  });

  it('forwards options and returns service results', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    const fileOptions = { title: 'Pick', filters: [{ name: 'Text', extensions: ['txt'] }] };
    const dirOptions = { title: 'Pick Dir', defaultPath: '/tmp' };

    const fileResult = await handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, fileOptions);
    const dirResult = await handlers.get(IPC_INVOKE_CHANNELS.pickDirectory)?.({}, dirOptions);
    const fileDefault = await handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, undefined);
    const dirDefault = await handlers.get(IPC_INVOKE_CHANNELS.pickDirectory)?.({}, undefined);

    expect(actions.pickFile).toHaveBeenCalledWith(fileOptions);
    expect(actions.pickDirectory).toHaveBeenCalledWith(dirOptions);
    expect(actions.pickFile).toHaveBeenLastCalledWith(undefined);
    expect(actions.pickDirectory).toHaveBeenLastCalledWith(undefined);
    expect(fileResult).toEqual(['/tmp/a.txt']);
    expect(dirResult).toBe('/tmp/selected');
    expect(fileDefault).toEqual(['/tmp/a.txt']);
    expect(dirDefault).toBe('/tmp/selected');
  });

  it('forwards path inspections to the service actions', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    const mofox = await handlers.get(IPC_INVOKE_CHANNELS.inspectImportPath)?.(
      {},
      '/bots/neo-mofox',
    );
    const platform = await handlers.get(IPC_INVOKE_CHANNELS.inspectPlatformImportPath)?.(
      {},
      'napcat',
      '/bots/napcat',
    );

    expect(actions.inspectImportPath).toHaveBeenCalledWith('/bots/neo-mofox');
    expect(actions.inspectPlatformPath).toHaveBeenCalledWith('napcat', '/bots/napcat');
    expect(mofox).toEqual({ absolute: true, exists: true, isDirectory: true, mainPyExists: true });
    expect(platform).toEqual({ absolute: true, exists: true, isDirectory: true, valid: true });
  });

  it('rejects malformed inspection arguments before calling the service', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.inspectImportPath)?.({}, '')).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.inspectPlatformImportPath)?.({}, 'napcat', ''),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.inspectPlatformImportPath)?.({}, 42, '/bots/napcat'),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.inspectImportPath).not.toHaveBeenCalled();
    expect(actions.inspectPlatformPath).not.toHaveBeenCalled();
  });

  it('forwards validated https urls to the open external action', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    await handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.(
      {},
      'https://github.com/example/repo?tab=readme',
    );

    expect(actions.openExternal).toHaveBeenCalledWith('https://github.com/example/repo?tab=readme');
  });

  it('allows plain http urls pointing at loopback hosts', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    for (const url of [
      'http://localhost:6099/webui',
      'http://127.0.0.1:6099',
      'http://127.10.20.30:8080/',
      'http://[::1]:6099',
      'http://0.0.0.0:6099/webui',
    ]) {
      await handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, url);
    }

    expect(actions.openExternal).toHaveBeenNthCalledWith(1, 'http://localhost:6099/webui');
    expect(actions.openExternal).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:6099/');
    expect(actions.openExternal).toHaveBeenNthCalledWith(3, 'http://127.10.20.30:8080/');
    expect(actions.openExternal).toHaveBeenNthCalledWith(4, 'http://[::1]:6099/');
    expect(actions.openExternal).toHaveBeenNthCalledWith(5, 'http://0.0.0.0:6099/webui');
  });

  it('rejects unsafe external urls before calling the open external action', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, '')).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, 'not a url')).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, 'http://example.com'),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, 'ftp://localhost')).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, 'http://192.168.1.10:6099'),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, 'https://user:pass@example.com'),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, 'http://user:pass@localhost'),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(handlers.get(IPC_INVOKE_CHANNELS.openExternal)?.({}, 42)).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    expect(actions.openExternal).not.toHaveBeenCalled();
  });

  it('rejects non-object file picker options', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, null)).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, 'x')).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, [])).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    expect(actions.pickFile).not.toHaveBeenCalled();
  });

  it('rejects non-object directory picker options', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.pickDirectory)?.({}, null)).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(handlers.get(IPC_INVOKE_CHANNELS.pickDirectory)?.({}, 42)).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    expect(actions.pickDirectory).not.toHaveBeenCalled();
  });

  it('rejects malformed file picker field types', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, { title: 1 })).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, { defaultPath: 1 }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, { multiSelections: 'yes' }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, { filters: 'x' }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, { filters: [{ name: 'X' }] }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, { filters: [{ name: 1, extensions: [] }] }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.(
        {},
        { filters: [{ name: 'X', extensions: [1] }] },
      ),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.pickFile).not.toHaveBeenCalled();
  });

  it('rejects malformed directory picker field types', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.pickDirectory)?.({}, { title: 1 }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.pickDirectory)?.({}, { defaultPath: 1 }),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.pickDirectory).not.toHaveBeenCalled();
  });

  it('serializes service failures into stable IPC errors', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    actions.pickFile.mockRejectedValueOnce(
      Object.assign(new Error('dialog crashed'), { code: 'INTERNAL' }),
    );
    registerCommonIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, undefined)).rejects.toThrow(
      'MOFOX_ERROR:',
    );
  });

  it('accepts a valid filter and forwards it through', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const actions = createActions();
    registerCommonIpc(ipcMain, actions);

    const options = {
      title: 'Images',
      defaultPath: '/tmp',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg'] },
        { name: 'All', extensions: ['*'] },
      ],
      multiSelections: true,
    };

    await handlers.get(IPC_INVOKE_CHANNELS.pickFile)?.({}, options);

    expect(actions.pickFile).toHaveBeenCalledWith(options);
  });
});
