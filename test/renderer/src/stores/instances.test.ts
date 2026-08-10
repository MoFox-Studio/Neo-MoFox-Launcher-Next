import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listInstances, listeners } = vi.hoisted(() => ({
  listInstances: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
}));
vi.mock('@/services/mofox-api', () => ({
  mofoxApi: {
    listInstances,
    startInstance: vi.fn(),
    stopInstance: vi.fn(),
    removeInstance: vi.fn(),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    }),
  },
}));

import { useInstancesStore } from '../../../../src/renderer/src/stores/instances';

describe('instances store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listeners.clear();
    listInstances.mockReset().mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test',
        platformVersion: '4.2.19',
        mofoxInstallDir: 'D:\\Bots\\Test',
        platforms: { napcat: 'D:\\Bots\\Test\\napcat' },
        status: 'stopped',
        createdAt: 1,
        autoStart: false,
      },
    ]);
  });

  // 覆盖列表加载、实时状态/日志同步、清空日志和订阅释放。
  it('refreshes persisted instances and reacts to status events', async () => {
    const scope = effectScope();
    const store = scope.run(() => useInstancesStore());
    if (!store) throw new Error('Store scope was not created');

    await store.refresh();
    listeners.get('instance-status-changed')?.({ instanceId: 'instance-1', status: 'running' });
    listeners.get('instance-pty-data')?.({ instanceId: 'instance-1', source: 'platform', data: 'NapCat ready\r\n' });

    expect(store.instances[0]?.status).toBe('running');
    expect(store.running).toHaveLength(1);
    expect(store.logs['instance-1:platform']).toBe('NapCat ready\r\n');
    store.clearLog('instance-1', 'platform');
    expect(store.logs['instance-1:platform']).toBe('');
    store.$dispose();
    scope.stop();
    expect(listeners.has('instance-status-changed')).toBe(false);
    expect(listeners.has('instance-pty-data')).toBe(false);
  });
});
