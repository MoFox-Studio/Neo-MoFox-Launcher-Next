import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerInstanceIpc } from '../../../src/main/ipc/instances';

function createService() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    remove: vi.fn(),
    openFolder: vi.fn(),
    getLogBuffer: vi.fn(() => 'buffered'),
    clearLogBuffer: vi.fn(),
    writePty: vi.fn(),
    resizePty: vi.fn(),
    getStats: vi.fn(() => ({
      mofox: { running: false, uptimeMs: null, pid: null },
      platform: { running: false, uptimeMs: null, pid: null },
    })),
    exportLogs: vi.fn(async () => 'D:\\exports\\log.log'),
  };
}

describe('registerInstanceIpc', () => {
  it('registers and forwards every instance action', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) };
    const service = createService();
    registerInstanceIpc(ipcMain, service);

    await handlers.get(IPC_INVOKE_CHANNELS.startInstance)?.({}, 'one');
    await handlers.get(IPC_INVOKE_CHANNELS.stopInstance)?.({}, 'one');
    await handlers.get(IPC_INVOKE_CHANNELS.restartInstance)?.({}, 'one');
    await handlers.get(IPC_INVOKE_CHANNELS.removeInstance)?.({}, 'one');
    await handlers.get(IPC_INVOKE_CHANNELS.openInstanceFolder)?.({}, 'one');
    const buffer = await handlers.get(IPC_INVOKE_CHANNELS.getInstanceLogBuffer)?.({}, 'one', 'mofox');
    await handlers.get(IPC_INVOKE_CHANNELS.clearInstanceLogBuffer)?.({}, 'one', 'platform');
    await handlers.get(IPC_INVOKE_CHANNELS.writeInstancePty)?.({}, 'one', 'mofox', 'input');
    await handlers.get(IPC_INVOKE_CHANNELS.resizeInstancePty)?.({}, 'one', 'platform', 120, 30);
    const stats = await handlers.get(IPC_INVOKE_CHANNELS.getInstanceStats)?.({}, 'one');
    const exported = await handlers.get(IPC_INVOKE_CHANNELS.exportInstanceLogs)?.({}, 'one', 'mofox');

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.startInstance,
      IPC_INVOKE_CHANNELS.stopInstance,
      IPC_INVOKE_CHANNELS.restartInstance,
      IPC_INVOKE_CHANNELS.removeInstance,
      IPC_INVOKE_CHANNELS.openInstanceFolder,
      IPC_INVOKE_CHANNELS.getInstanceLogBuffer,
      IPC_INVOKE_CHANNELS.clearInstanceLogBuffer,
      IPC_INVOKE_CHANNELS.writeInstancePty,
      IPC_INVOKE_CHANNELS.resizeInstancePty,
      IPC_INVOKE_CHANNELS.getInstanceStats,
      IPC_INVOKE_CHANNELS.exportInstanceLogs,
    ]);
    expect(service.start).toHaveBeenCalledWith('one');
    expect(service.stop).toHaveBeenCalledWith('one');
    expect(service.restart).toHaveBeenCalledWith('one');
    expect(service.remove).toHaveBeenCalledWith('one');
    expect(service.openFolder).toHaveBeenCalledWith('one');
    expect(buffer).toBe('buffered');
    expect(service.getLogBuffer).toHaveBeenCalledWith('one', 'mofox');
    expect(service.clearLogBuffer).toHaveBeenCalledWith('one', 'platform');
    expect(service.writePty).toHaveBeenCalledWith('one', 'mofox', 'input');
    expect(service.resizePty).toHaveBeenCalledWith('one', 'platform', 120, 30);
    expect(stats).toEqual({
      mofox: { running: false, uptimeMs: null, pid: null },
      platform: { running: false, uptimeMs: null, pid: null },
    });
    expect(exported).toBe('D:\\exports\\log.log');
  });

  it('rejects an empty instance id with a stable error', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) };
    const service = createService();
    registerInstanceIpc(ipcMain, service);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.startInstance)?.({}, ' ')).rejects.toThrow('MOFOX_ERROR:');
    expect(service.start).not.toHaveBeenCalled();
  });

  it('rejects invalid pty arguments and unknown sources', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) };
    const service = createService();
    registerInstanceIpc(ipcMain, service);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.writeInstancePty)?.({}, 'one', 'mofox', 42)).rejects.toThrow('MOFOX_ERROR:');
    await expect(handlers.get(IPC_INVOKE_CHANNELS.resizeInstancePty)?.({}, 'one', 'mofox', 'x', 30)).rejects.toThrow('MOFOX_ERROR:');
    await expect(handlers.get(IPC_INVOKE_CHANNELS.getInstanceLogBuffer)?.({}, 'one', 'bogus')).rejects.toThrow('MOFOX_ERROR:');
    expect(service.writePty).not.toHaveBeenCalled();
    expect(service.resizePty).not.toHaveBeenCalled();
    expect(service.getLogBuffer).not.toHaveBeenCalled();
  });
});
