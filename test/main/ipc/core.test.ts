import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerCoreIpc } from '../../../src/main/ipc/core';

/** 验证核心 IPC 的通道注册、参数转发，以及服务/边界校验错误的协议化返回。 */
describe('registerCoreIpc', () => {
  it('registers every stage-two service channel', () => {
    const channels: string[] = [];
    const ipcMain = { handle: vi.fn((channel: string) => channels.push(channel)) };

    registerCoreIpc(ipcMain, createServices());

    expect(channels).toEqual([
      IPC_INVOKE_CHANNELS.listInstances,
      IPC_INVOKE_CHANNELS.detectSystemEnv,
      IPC_INVOKE_CHANNELS.listBotPlatforms,
      IPC_INVOKE_CHANNELS.getSettings,
      IPC_INVOKE_CHANNELS.updateSettings,
    ]);
  });

  it('forwards arguments and converts domain failures to stable IPC errors', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      ),
    };
    const services = createServices();
    services.settings.update.mockRejectedValue(Object.assign(new Error('bad patch'), { code: 'INVALID_ARGUMENT' }));
    registerCoreIpc(ipcMain, services);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.updateSettings)?.({}, { themeMode: 'purple' }),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(services.settings.update).toHaveBeenCalledWith({ themeMode: 'purple' });
  });

  it('rejects non-object settings patches before calling the service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
    };
    const services = createServices();
    registerCoreIpc(ipcMain, services);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.updateSettings)?.({}, null)).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    expect(services.settings.update).not.toHaveBeenCalled();
  });
});

function createServices() {
  return {
    instances: { list: vi.fn(async () => []) },
    environment: { detect: vi.fn(async () => ({})) },
    platforms: { list: vi.fn(() => []) },
    settings: {
      get: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  };
}
