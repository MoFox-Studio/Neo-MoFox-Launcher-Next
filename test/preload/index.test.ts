import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {},
}));

import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '../../src/shared/ipc';
import { createMofoxApi } from '../../src/preload/index';

/** 预加载门面应严格受共享 IPC 白名单约束。 */
describe('createMofoxApi', () => {
  /** 覆盖所有请求方法与通道表的一一映射，防止新增 API 绕过白名单。 */
  it('forwards every invoke method to its allowlisted channel', async () => {
    const ipcRenderer = {
      invoke: vi.fn(async (..._args: unknown[]) => undefined),
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
    await api.updateInstancePaths('instance-1', {
      mofoxInstallDir: 'D:\\MoFox',
      platforms: { snowluma: 'E:\\SnowLuma' },
    });
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
    await api.scanInstancePlugins('instance-1');
    await api.scanInstancePluginConfigs('instance-1');
    await api.exportIntegrationPack('instance-1', {
      packName: 'Test',
      packVersion: '1.0.0',
      packAuthor: '',
      packDescription: '',
      includeMofox: true,
      includeConfig: true,
      includePlugins: true,
      selectedPlugins: [],
      includePluginConfigs: false,
      selectedPluginConfigs: [],
      includeData: false,
    }, 'C:\\MoFox\\test.mfpack');
    await api.validateIntegrationPack('C:\\MoFox\\test.mfpack');
    await api.importIntegrationPack({
      packPath: 'C:\\MoFox\\test.mfpack',
      instanceName: 'Test',
      targetDir: 'C:\\MoFox',
    });
    await api.manualAddInstance({
      mofoxInstallDir: 'C:\\MoFox',
      displayName: 'Test',
    });
    await api.detectSystemEnv();
    await api.listBotPlatforms();
    await api.getSettings();
    await api.updateSettings({ themeMode: 'dark' });
    await api.detectLegacyLauncher();
    await api.previewLegacyMigration();
    await api.importLegacyMigration();
    await api.oobeVerifySudo('password');
    await api.oobeInspectDependencies();
    await api.oobeInstallDependencies();
    await api.oobeCancelInstall();
    await api.oobeComplete();
    await api.pickFile();
    await api.pickDirectory();
    await api.selectWallpaper();
    await api.commitWallpaper('wallpaper-1');
    await api.discardWallpaper('wallpaper-1');
    await api.removeWallpaper();

    expect(ipcRenderer.invoke.mock.calls.map((call) => call[0])).toEqual(
      Object.values(IPC_INVOKE_CHANNELS),
    );
  });

  /** 验证事件载荷转发，并确保退订时使用注册时的包装监听器。 */
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

  /** 边界场景：运行时伪造的事件名不得注册到底层 IPC。 */
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
