import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listeners, startInstall, getInstallTask } = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
  startInstall: vi.fn(),
  getInstallTask: vi.fn(),
}));

vi.mock('@/services/mofox-api', () => ({
  mofoxApi: {
    startInstall,
    getInstallTask,
    retryInstall: vi.fn(),
    cancelInstall: vi.fn(),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    }),
  },
}));

import { useInstallStore } from '../../../../src/renderer/src/stores/install';
import type { InstallRequest } from '../../../../src/shared/domain/install';

const request: InstallRequest = {
  instanceName: 'first',
  platformId: '',
  mofoxBranch: 'main',
  wsPort: 8095,
  botQQ: '12345',
  botNickname: 'bot',
  ownerQQ: '12345',
  apiKey: 'sk-test',
  installWebui: false,
  webuiApiKey: '',
  targetDir: 'D:\\Bots',
};

function snapshot(taskId: string, instanceName: string) {
  return {
    request: { ...request, instanceName },
    progress: {
      taskId,
      instanceName,
      step: 'install-mofox' as const,
      stepIndex: 0,
      stepCount: 3,
      status: 'running' as const,
      progress: 0,
      message: '开始安装',
    },
  };
}

describe('install store sequential installs', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listeners.clear();
    startInstall.mockReset();
    getInstallTask.mockReset();
  });

  it('clears a completed task and starts a second instance in the same renderer process', async () => {
    const scope = effectScope();
    const store = scope.run(() => useInstallStore());
    if (!store) throw new Error('Store scope was not created');
    startInstall.mockResolvedValueOnce('task-1').mockResolvedValueOnce('task-2');
    getInstallTask
      .mockResolvedValueOnce(snapshot('task-1', 'first'))
      .mockResolvedValueOnce(snapshot('task-2', 'second'));

    await store.begin(request);
    listeners.get('install-progress')?.({
      ...snapshot('task-1', 'first').progress,
      status: 'done',
      progress: 1,
    });
    expect(store.isDone).toBe(true);
    expect(store.prepareForNewInstall()).toBe(true);
    expect(store.activeTaskId).toBeNull();

    await store.begin({ ...request, instanceName: 'second' });
    expect(startInstall).toHaveBeenCalledTimes(2);
    expect(store.activeTaskId).toBe('task-2');
    expect(store.progress?.instanceName).toBe('second');

    store.$dispose();
    scope.stop();
  });

  it('keeps failed tasks available for retry instead of silently discarding them', async () => {
    const store = useInstallStore();
    store.progress = { ...snapshot('task-1', 'first').progress, status: 'failed' };
    store.activeTaskId = 'task-1';
    expect(store.prepareForNewInstall()).toBe(false);
    expect(store.activeTaskId).toBe('task-1');
  });
});
