import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import type { Instance, UpdateInstancePatch } from '@shared/domain/instance';
import { mofoxApi } from '@/services/mofox-api';

// 实例仓库集中管理列表、进程状态事件和截断后的实时日志缓存。
export const useInstancesStore = defineStore('instances', () => {
  // 列表加载态与按“实例:来源”索引的日志响应式状态。
  const instances = ref<Instance[]>([]);
  const loading = ref(false);
  const logs = ref<Record<string, string>>({});

  const running = computed(() => instances.value.filter((i) => i.status === 'running'));

  /**
   * 从当前响应式实例列表中查找指定实例。
   *
   * @param id - 待查找的实例 ID。
   * @returns 匹配的实例；不存在时为 `undefined`。
   */
  const byId = (id: string) => instances.value.find((i) => i.id === id);

  // IPC 事件直接合并到当前列表，避免每条日志都触发全量刷新。
  const unsubscribeStatus = mofoxApi.on('instance-status-changed', ({ instanceId, status }) => {
    const ins = byId(instanceId);
    if (ins) ins.status = status;
  });
  const unsubscribePty = mofoxApi.on('instance-pty-data', ({ instanceId, source, data }) => {
    const key = `${instanceId}:${source}`;
    const output = `${logs.value[key] ?? ''}${stripAnsi(data)}`;
    logs.value[key] = output.length > 200_000 ? output.slice(-200_000) : output;
  });
  onScopeDispose(() => {
    unsubscribeStatus();
    unsubscribePty();
  });

  async function refresh(): Promise<void> {
    // 无论请求成功与否都恢复加载态，避免界面永久阻塞。
    loading.value = true;
    try {
      instances.value = await mofoxApi.listInstances();
    } finally {
      loading.value = false;
    }
  }

  async function start(id: string): Promise<void> {
    // 进程操作完成后刷新持久化列表以获得最终状态。
    await mofoxApi.startInstance(id);
    await refresh();
  }

  async function stop(id: string): Promise<void> {
    await mofoxApi.stopInstance(id);
    await refresh();
  }

  async function restart(id: string): Promise<void> {
    await mofoxApi.restartInstance(id);
    await refresh();
  }

  async function remove(id: string): Promise<void> {
    await mofoxApi.removeInstance(id);
    delete logs.value[`${id}:mofox`];
    delete logs.value[`${id}:platform`];
    await refresh();
  }

  async function update(id: string, patch: UpdateInstancePatch): Promise<void> {
    await mofoxApi.updateInstance(id, patch);
    await refresh();
  }

  function clearLog(id: string, source: 'mofox' | 'platform'): void {
    logs.value[`${id}:${source}`] = '';
  }

  return { instances, loading, logs, running, byId, refresh, start, stop, restart, remove, update, clearLog };
});

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  // 优先匹配 CSI 序列，避免单字符分支吞掉开头的 '['。
  return value.replace(new RegExp(`${escape}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`, 'g'), '');
}
