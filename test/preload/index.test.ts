import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {},
}));

import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '../../src/shared/ipc';
import { createMofoxApi } from '../../src/preload/index';

describe('createMofoxApi', () => {
  it('forwards every invoke method to its allowlisted channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn(async () => undefined),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const api = createMofoxApi(ipcRenderer);

    await api.windowMinimize();
    await api.windowToggleMaximize();
    await api.windowClose();
    await api.windowIsMaximized();
    await api.listInstances();
    await api.startInstance('instance-1');
    await api.stopInstance('instance-1');
    await api.restartInstance('instance-1');
    await api.removeInstance('instance-1');
    await api.openInstanceFolder('instance-1');
    await api.getInstanceLogBuffer('instance-1', 'mofox');
    await api.clearInstanceLogBuffer('instance-1', 'platform');
    await api.writeInstancePty('instance-1', 'mofox', 'help\r');
    await api.resizeInstancePty('instance-1', 'platform', 120, 30);
    await api.getInstanceStats('instance-1');
    await api.exportInstanceLogs('instance-1', 'mofox');
    await api.startInstall({
      instanceName: 'Test',
      platformId: 'napcat',
      version: 'latest',
      targetDir: 'C:\\MoFox',
    });
    await api.retryInstall('task-1');
    await api.cancelInstall('task-1');
    await api.detectSystemEnv();
    await api.listMirrors();
    await api.selectBestMirror();
    await api.listBotPlatforms();
    await api.getSettings();
    await api.updateSettings({ themeMode: 'dark' });

    expect(ipcRenderer.invoke.mock.calls.map(([channel]) => channel)).toEqual(
      Object.values(IPC_INVOKE_CHANNELS),
    );
  });

  it('forwards event payloads and removes the exact listener on unsubscribe', () => {
    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const api = createMofoxApi(ipcRenderer);
    const listener = vi.fn();

    const unsubscribe = api.on('window-maximize-changed', listener);
    const wrappedListener = ipcRenderer.on.mock.calls[0]?.[1];
    wrappedListener({}, true);
    unsubscribe();

    expect(ipcRenderer.on).toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS['window-maximize-changed'],
      wrappedListener,
    );
    expect(listener).toHaveBeenCalledWith(true);
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_EVENT_CHANNELS['window-maximize-changed'],
      wrappedListener,
    );
  });

  it('rejects event names outside the shared allowlist', () => {
    const ipcRenderer = {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const api = createMofoxApi(ipcRenderer);

    expect(() => api.on('unknown' as 'log-output', vi.fn())).toThrowError(
      'Unsupported IPC event: unknown',
    );
    expect(ipcRenderer.on).not.toHaveBeenCalled();
  });
});