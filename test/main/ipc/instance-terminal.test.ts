import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerInstanceTerminalIpc } from '../../../src/main/ipc/instance-terminal';

/** 验证终端通道完整映射，以及非法 ID、目录种类和打开参数在服务调用前被拒绝。 */
function createService() {
  return {
    listShells: vi.fn(async () => [
      { id: 'bash', label: 'Bash', command: '/bin/bash', args: [], isDefault: true },
    ]),
    open: vi.fn(async () => ({ cwd: '/tmp/mofox' })),
    write: vi.fn(),
    resize: vi.fn(),
    close: vi.fn(async () => undefined),
  };
}

describe('registerInstanceTerminalIpc', () => {
  it('registers and forwards every terminal action', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const service = createService();
    registerInstanceTerminalIpc(ipcMain, service);

    const shells = await handlers.get(IPC_INVOKE_CHANNELS.listInstanceTerminalShells)?.({});
    const opened = await handlers.get(IPC_INVOKE_CHANNELS.openInstanceTerminal)?.(
      {},
      'one',
      'mofox',
      { shellId: 'bash', size: { cols: 120, rows: 30 } },
    );
    await handlers.get(IPC_INVOKE_CHANNELS.writeInstanceTerminal)?.({}, 'one', 'ls\r');
    await handlers.get(IPC_INVOKE_CHANNELS.resizeInstanceTerminal)?.({}, 'one', 100, 24);
    await handlers.get(IPC_INVOKE_CHANNELS.closeInstanceTerminal)?.({}, 'one');

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.listInstanceTerminalShells,
      IPC_INVOKE_CHANNELS.openInstanceTerminal,
      IPC_INVOKE_CHANNELS.writeInstanceTerminal,
      IPC_INVOKE_CHANNELS.resizeInstanceTerminal,
      IPC_INVOKE_CHANNELS.closeInstanceTerminal,
    ]);
    expect(shells).toEqual([
      { id: 'bash', label: 'Bash', command: '/bin/bash', args: [], isDefault: true },
    ]);
    expect(opened).toEqual({ cwd: '/tmp/mofox' });
    expect(service.open).toHaveBeenCalledWith('one', 'mofox', {
      shellId: 'bash',
      size: { cols: 120, rows: 30 },
    });
    expect(service.write).toHaveBeenCalledWith('one', 'ls\r');
    expect(service.resize).toHaveBeenCalledWith('one', 100, 24);
    expect(service.close).toHaveBeenCalledWith('one');
  });

  it('allows omitting the terminal options', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const service = createService();
    registerInstanceTerminalIpc(ipcMain, service);

    await handlers.get(IPC_INVOKE_CHANNELS.openInstanceTerminal)?.({}, 'one', 'venv');

    expect(service.open).toHaveBeenCalledWith('one', 'venv', undefined);
  });

  it('rejects an unknown directory kind before reaching the service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const service = createService();
    registerInstanceTerminalIpc(ipcMain, service);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openInstanceTerminal)?.({}, 'one', 'install'),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(service.open).not.toHaveBeenCalled();
  });

  it('rejects an empty instance id and non-numeric terminal sizes', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const service = createService();
    registerInstanceTerminalIpc(ipcMain, service);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openInstanceTerminal)?.({}, ' ', 'mofox'),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.resizeInstanceTerminal)?.({}, 'one', 'wide', 24),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openInstanceTerminal)?.({}, 'one', 'mofox', {
        size: { cols: 80 },
      }),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(service.open).not.toHaveBeenCalled();
    expect(service.resize).not.toHaveBeenCalled();
  });

  it('rejects malformed shell options before reaching the service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const service = createService();
    registerInstanceTerminalIpc(ipcMain, service);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openInstanceTerminal)?.({}, 'one', 'mofox', 'bash'),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.openInstanceTerminal)?.({}, 'one', 'mofox', { shellId: 42 }),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(service.open).not.toHaveBeenCalled();
  });
});
