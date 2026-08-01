import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerWindowIpc } from '../../../src/main/ipc/window';

type Handler = () => unknown;

function createIpcMain() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)),
  };
}

describe('registerWindowIpc', () => {
  it('registers every window invoke channel', () => {
    const ipcMain = createIpcMain();

    registerWindowIpc(ipcMain, () => null);

    expect([...ipcMain.handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.windowMinimize,
      IPC_INVOKE_CHANNELS.windowToggleMaximize,
      IPC_INVOKE_CHANNELS.windowClose,
      IPC_INVOKE_CHANNELS.windowIsMaximized,
    ]);
  });

  it('controls the current window and reports maximize state', async () => {
    const ipcMain = createIpcMain();
    const window = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
    };
    registerWindowIpc(ipcMain, () => window);

    await ipcMain.handlers.get(IPC_INVOKE_CHANNELS.windowMinimize)?.();
    await ipcMain.handlers.get(IPC_INVOKE_CHANNELS.windowToggleMaximize)?.();
    await ipcMain.handlers.get(IPC_INVOKE_CHANNELS.windowClose)?.();
    const maximized = await ipcMain.handlers.get(IPC_INVOKE_CHANNELS.windowIsMaximized)?.();

    expect(window.minimize).toHaveBeenCalledOnce();
    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.unmaximize).not.toHaveBeenCalled();
    expect(window.close).toHaveBeenCalledOnce();
    expect(maximized).toBe(false);
  });

  it('restores a maximized window', async () => {
    const ipcMain = createIpcMain();
    const window = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => true),
    };
    registerWindowIpc(ipcMain, () => window);

    await ipcMain.handlers.get(IPC_INVOKE_CHANNELS.windowToggleMaximize)?.();

    expect(window.unmaximize).toHaveBeenCalledOnce();
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it('is safe while no window exists', async () => {
    const ipcMain = createIpcMain();
    registerWindowIpc(ipcMain, () => null);

    expect(ipcMain.handlers.get(IPC_INVOKE_CHANNELS.windowMinimize)?.()).toBeUndefined();
    expect(ipcMain.handlers.get(IPC_INVOKE_CHANNELS.windowIsMaximized)?.()).toBe(false);
  });
});