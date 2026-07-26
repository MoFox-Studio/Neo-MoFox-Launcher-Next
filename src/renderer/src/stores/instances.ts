import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import type { Instance } from '@shared/domain/instance';
import { mofoxApi } from '@/services/mofox-api';

export const useInstancesStore = defineStore('instances', () => {
  const instances = ref<Instance[]>([]);
  const loading = ref(false);
  const logs = ref<Record<string, string>>({});

  const running = computed(() => instances.value.filter((i) => i.status === 'running'));
  const byId = (id: string) => instances.value.find((i) => i.id === id);

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
    loading.value = true;
    try {
      instances.value = await mofoxApi.listInstances();
    } finally {
      loading.value = false;
    }
  }

  async function start(id: string): Promise<void> {
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

  function clearLog(id: string, source: 'mofox' | 'platform'): void {
    logs.value[`${id}:${source}`] = '';
  }

  return { instances, loading, logs, running, byId, refresh, start, stop, restart, remove, clearLog };
});

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  // CSI sequence first so the single-char alternative cannot eat the leading '['.
  return value.replace(new RegExp(`${escape}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`, 'g'), '');
}
