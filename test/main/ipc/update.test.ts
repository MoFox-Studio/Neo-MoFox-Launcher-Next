import { describe, expect, it, vi } from 'vitest';
import type { MofoxUpdateInfo, PlatformUpdateInfo } from '../../../src/shared/domain/update';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerUpdateIpc } from '../../../src/main/ipc/update';

/** 验证更新通道完整映射，以及非法实例 ID / 参数在服务调用前被拒绝。 */
function createActions() {
  const info: MofoxUpdateInfo = {
    isRepository: true,
    branch: 'main',
    currentCommit: { hash: 'a1b2c3d', message: 'fix', date: '2026-08-01T00:00:00Z' },
    branches: ['main', 'dev'],
    commits: [],
    hasUpdate: false,
    behindCount: 0,
    aheadCount: 0,
  };
  const platformInfo: PlatformUpdateInfo = {
    installed: true,
    currentVersion: 'v1.0.0',
    releases: [],
  };
  return {
    getMofoxInfo: vi.fn(async () => info),
    switchBranch: vi.fn(async () => info),
    checkoutCommit: vi.fn(async () => info),
    updateMofox: vi.fn(async () => info),
    getPlatformInfo: vi.fn(async () => platformInfo),
    updatePlatform: vi.fn(async () => platformInfo),
  };
}

describe('registerUpdateIpc', () => {
  it('registers and forwards every update action', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    registerUpdateIpc(ipcMain, actions);

    await handlers.get(IPC_INVOKE_CHANNELS.getMofoxUpdateInfo)?.({}, 'one');
    await handlers.get(IPC_INVOKE_CHANNELS.switchMofoxBranch)?.({}, 'one', 'dev');
    await handlers.get(IPC_INVOKE_CHANNELS.checkoutMofoxCommit)?.({}, 'one', 'a1b2c3d');
    await handlers.get(IPC_INVOKE_CHANNELS.updateMofox)?.({}, 'one');
    await handlers.get(IPC_INVOKE_CHANNELS.getPlatformUpdateInfo)?.({}, 'one');
    await handlers.get(IPC_INVOKE_CHANNELS.updatePlatform)?.({}, 'one', 'v2.0.0');

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.getMofoxUpdateInfo,
      IPC_INVOKE_CHANNELS.switchMofoxBranch,
      IPC_INVOKE_CHANNELS.checkoutMofoxCommit,
      IPC_INVOKE_CHANNELS.updateMofox,
      IPC_INVOKE_CHANNELS.getPlatformUpdateInfo,
      IPC_INVOKE_CHANNELS.updatePlatform,
    ]);
    expect(actions.getMofoxInfo).toHaveBeenCalledWith('one');
    expect(actions.switchBranch).toHaveBeenCalledWith('one', 'dev');
    expect(actions.checkoutCommit).toHaveBeenCalledWith('one', 'a1b2c3d');
    expect(actions.updateMofox).toHaveBeenCalledWith('one');
    expect(actions.getPlatformInfo).toHaveBeenCalledWith('one');
    expect(actions.updatePlatform).toHaveBeenCalledWith('one', 'v2.0.0');
  });

  it('rejects an empty instance id with a stable error', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    registerUpdateIpc(ipcMain, actions);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.updateMofox)?.({}, ' ')).rejects.toThrow(
      'MOFOX_ERROR:',
    );
    expect(actions.updateMofox).not.toHaveBeenCalled();
  });

  it('rejects malformed branch, commit and version arguments', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    registerUpdateIpc(ipcMain, actions);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.switchMofoxBranch)?.({}, 'one', 42),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.checkoutMofoxCommit)?.({}, 'one', ''),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.updatePlatform)?.({}, 'one', null),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(actions.switchBranch).not.toHaveBeenCalled();
    expect(actions.checkoutCommit).not.toHaveBeenCalled();
    expect(actions.updatePlatform).not.toHaveBeenCalled();
  });
});
