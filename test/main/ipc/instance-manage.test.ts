import { describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerInstanceManageIpc } from '../../../src/main/ipc/instance-manage';

/** 验证实例管理通道完整映射，以及非法 ID 和非法更新补丁在服务调用前被拒绝。 */
function createActions() {
  return {
    remove: vi.fn(),
    openFolder: vi.fn(),
    update: vi.fn(async (): Promise<Instance> => ({
      id: 'one',
      name: 'One',
      mofoxInstallDir: 'D:\\Bot',
      platform: { id: 'test', installDir: 'D:\\Bot', version: '1' },
      status: 'stopped',
      createdAt: 1,
      lastStartedAt: null,
      autoStart: false,
    })),
  };
}

describe('registerInstanceManageIpc', () => {
  it('registers and forwards every manage action', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    registerInstanceManageIpc(ipcMain, actions);

    await handlers.get(IPC_INVOKE_CHANNELS.removeInstance)?.({}, 'one');
    await handlers.get(IPC_INVOKE_CHANNELS.openInstanceFolder)?.({}, 'one');
    const updated = (await handlers.get(IPC_INVOKE_CHANNELS.updateInstance)?.({}, 'one', {
      name: 'Renamed',
    })) as Instance;

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.removeInstance,
      IPC_INVOKE_CHANNELS.openInstanceFolder,
      IPC_INVOKE_CHANNELS.updateInstance,
    ]);
    expect(actions.remove).toHaveBeenCalledWith('one');
    expect(actions.openFolder).toHaveBeenCalledWith('one');
    expect(actions.update).toHaveBeenCalledWith('one', { name: 'Renamed' });
    expect(updated.name).toBe('One');
  });

  it('rejects an empty instance id with a stable error', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    registerInstanceManageIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.removeInstance)?.({}, ' ')).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it('rejects malformed update patches before calling the service', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    registerInstanceManageIpc(ipcMain, actions);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.updateInstance)?.({}, 'one', 'nope'),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.updateInstance)?.({}, 'one', { name: 42 }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.updateInstance)?.({}, 'one', { autoStart: 'yes' }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.updateInstance)?.({}, 'one', { platform: { id: 7 } }),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.update).not.toHaveBeenCalled();
  });
});
