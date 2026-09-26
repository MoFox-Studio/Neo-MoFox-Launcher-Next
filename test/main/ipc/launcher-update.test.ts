import { describe, expect, it, vi } from 'vitest';
import type {
  LauncherBuildInfo,
  LauncherReleaseNotes,
  LauncherUpdateInfo,
} from '../../../src/shared/domain/app-update';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerLauncherUpdateIpc } from '../../../src/main/ipc/launcher-update';

/** 构造各通道共用的动作替身。 */
function createActions() {
  const buildInfo: LauncherBuildInfo = {
    version: '0.1.0',
    channel: 'nightly',
    buildDate: '20260926',
    tag: 'nightly-20260926',
    commit: '3d68ddc',
  };
  const updateInfo: LauncherUpdateInfo = {
    updateAvailable: false,
    current: buildInfo,
    latestVersion: '',
    latestTag: '',
    latestBuildDate: '',
    releaseUrl: '',
    releaseNotes: '',
    publishedAt: '',
  };
  const releaseNotes: LauncherReleaseNotes = {
    found: true,
    tag: 'nightly-20260926',
    name: '🌙 每夜构建 20260926',
    notes: '## 本次更新',
    publishedAt: '2026-09-26T16:05:00Z',
    url: 'https://github.com/MoFox-Studio/Neo-MoFox-Launcher-Next/releases/tag/nightly-20260926',
  };
  return {
    getBuildInfo: vi.fn(async () => buildInfo),
    check: vi.fn(async () => updateInfo),
    getReleaseNotes: vi.fn(async () => releaseNotes),
  };
}

describe('registerLauncherUpdateIpc', () => {
  it('registers and forwards all launcher update actions', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    registerLauncherUpdateIpc(ipcMain, actions);

    await handlers.get(IPC_INVOKE_CHANNELS.getLauncherBuildInfo)?.({});
    await handlers.get(IPC_INVOKE_CHANNELS.checkLauncherUpdate)?.({});
    await handlers.get(IPC_INVOKE_CHANNELS.getLauncherReleaseNotes)?.({});

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.getLauncherBuildInfo,
      IPC_INVOKE_CHANNELS.checkLauncherUpdate,
      IPC_INVOKE_CHANNELS.getLauncherReleaseNotes,
    ]);
    expect(actions.getBuildInfo).toHaveBeenCalledTimes(1);
    expect(actions.check).toHaveBeenCalledTimes(1);
    expect(actions.getReleaseNotes).toHaveBeenCalledTimes(1);
  });

  /** 边界场景：两个通道均不接受任何渲染端参数，多余参数被原样忽略而非透传。 */
  it('never forwards renderer arguments into the actions', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    registerLauncherUpdateIpc(ipcMain, actions);

    await handlers.get(IPC_INVOKE_CHANNELS.checkLauncherUpdate)?.({}, 'unexpected-arg');

    expect(actions.check).toHaveBeenCalledWith();
  });
});
