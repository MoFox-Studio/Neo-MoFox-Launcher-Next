import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listInstances, removeInstance, listeners } = vi.hoisted(() => ({
  listInstances: vi.fn(),
  removeInstance: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
}));
vi.mock('@/services/mofox-api', () => ({
  mofoxApi: {
    listInstances,
    removeInstance,
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    }),
  },
}));

import { useIntegrityStore } from '../../../../src/renderer/src/stores/integrity';
import type { InstanceIntegrityIssue } from '../../../../src/shared/domain/instance';

describe('integrity store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listeners.clear();
    listInstances.mockReset().mockResolvedValue([]);
    removeInstance.mockReset().mockResolvedValue(undefined);
  });

  it('opens with the reported issues and closes on keep-all', () => {
    const store = useIntegrityStore();
    const issues: InstanceIntegrityIssue[] = [
      { instanceId: 'one', name: 'One', problems: ['mofox'] },
    ];

    store.openWith(issues);

    expect(store.open).toBe(true);
    expect(store.issues).toEqual(issues);

    store.keepAll();

    expect(store.open).toBe(false);
    expect(store.issues).toEqual([]);
  });

  it('does not open when there are no issues', () => {
    const store = useIntegrityStore();

    store.openWith([]);

    expect(store.open).toBe(false);
    expect(store.issues).toEqual([]);
  });

  it('marks the instance as resolved and closes once every issue is finished', async () => {
    const store = useIntegrityStore();
    store.openWith([
      { instanceId: 'one', name: 'One', problems: ['mofox'] },
      { instanceId: 'two', name: 'Two', problems: ['platform'] },
    ]);

    await store.resolve('one', true);

    // 删除走实例仓库的移除动作，最终落到被 mock 的 removeInstance。
    expect(removeInstance).toHaveBeenCalledWith('one');
    // 处理后先保留在列表中供确认特效展示，由 finishResolve 移出。
    expect(store.resolved.get('one')).toBe(true);
    expect(store.issues).toHaveLength(2);
    expect(store.open).toBe(true);
    expect(store.pending.has('one')).toBe(false);

    store.finishResolve('one');
    expect(store.issues).toEqual([{ instanceId: 'two', name: 'Two', problems: ['platform'] }]);

    await store.resolve('two', false);
    expect(store.resolved.get('two')).toBe(false);
    expect(removeInstance).toHaveBeenCalledTimes(1);
    store.finishResolve('two');

    expect(store.issues).toEqual([]);
    expect(store.open).toBe(false);
  });

  it('marks the instance as pending while resolving and prevents re-entry', async () => {
    const store = useIntegrityStore();
    store.openWith([
      { instanceId: 'one', name: 'One', problems: ['mofox'] },
      { instanceId: 'two', name: 'Two', problems: ['platform'] },
    ]);
    let release: () => void = () => undefined;
    removeInstance.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

    const first = store.resolve('one', true);
    const second = store.resolve('one', true);

    expect(store.pending.has('one')).toBe(true);
    expect(removeInstance).toHaveBeenCalledTimes(1);

    release();
    await first;
    await second;

    expect(store.pending.has('one')).toBe(false);
    expect(store.resolved.get('one')).toBe(true);
    expect(store.issues).toHaveLength(2);

    store.finishResolve('one');
    expect(store.issues).toEqual([{ instanceId: 'two', name: 'Two', problems: ['platform'] }]);
  });

  it('keeps the instance without deleting it', async () => {
    const store = useIntegrityStore();
    store.openWith([{ instanceId: 'one', name: 'One', problems: ['mofox'] }]);

    await store.resolve('one', false);

    expect(removeInstance).not.toHaveBeenCalled();
    expect(store.resolved.get('one')).toBe(false);
    expect(store.open).toBe(true);
  });
});
