import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerInstallIpc } from '../../../src/main/ipc/install';

/** 覆盖安装请求与任务控制的转发路径，并确认畸形跨进程输入不会触发任务操作。 */
describe('registerInstallIpc', () => {
  it('validates and forwards install actions', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = {
      start: vi.fn(async () => 'task-1'),
      retry: vi.fn(),
      cancel: vi.fn(),
      fetchLicense: vi.fn(async () => ({
        eula: { source: 'GitHub', content: 'EULA' },
        privacy: { source: 'GitHub', content: 'PRIVACY' },
      })),
    };
    registerInstallIpc(ipcMain, actions);
    const request = {
      instanceName: 'Test',
      platformId: 'napcat',
      mofoxBranch: 'main',
      wsPort: 8095,
      botQQ: '12345678901',
      ownerQQ: '12345678901',
      apiKey: 'sk-test-1234',
      installWebui: true,
      webuiApiKey: 'abcdefgh',
      targetDir: 'D:\\Bots\\Test',
    };

    await expect(handlers.get(IPC_INVOKE_CHANNELS.startInstall)?.({}, request)).resolves.toBe(
      'task-1',
    );
    await handlers.get(IPC_INVOKE_CHANNELS.retryInstall)?.({}, 'task-1');
    await handlers.get(IPC_INVOKE_CHANNELS.cancelInstall)?.({}, 'task-1');
    await expect(handlers.get(IPC_INVOKE_CHANNELS.fetchLicense)?.({})).resolves.toEqual({
      eula: { source: 'GitHub', content: 'EULA' },
      privacy: { source: 'GitHub', content: 'PRIVACY' },
    });

    expect(actions.start).toHaveBeenCalledWith(request);
    expect(actions.retry).toHaveBeenCalledWith('task-1');
    expect(actions.cancel).toHaveBeenCalledWith('task-1');
    expect(actions.fetchLicense).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed input before invoking actions', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = { start: vi.fn(), retry: vi.fn(), cancel: vi.fn(), fetchLicense: vi.fn() };
    registerInstallIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.startInstall)?.({}, null)).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    expect(actions.start).not.toHaveBeenCalled();
  });
});
