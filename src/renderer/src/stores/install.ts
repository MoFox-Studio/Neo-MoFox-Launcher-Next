import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import type { InstallProgressEvent, InstallRequest } from '@shared/domain/instance';
import { mofoxApi } from '@/services/mofox-api';

/**
 * Install tasks live in this store (not in the wizard view), so leaving
 * the install screen keeps the task running in the background and the
 * user can come back to live progress. (Quality gate 03)
 */
export const useInstallStore = defineStore('install', () => {
  const activeTaskId = ref<string | null>(null);
  const progress = ref<InstallProgressEvent | null>(null);
  const logLines = ref<string[]>([]);

  const isInstalling = computed(
    () => progress.value !== null && progress.value.status === 'running',
  );
  const isFailed = computed(() => progress.value?.status === 'failed');
  const isDone = computed(() => progress.value?.status === 'done');

  const unsubscribe = mofoxApi.on('install-progress', (event) => {
    if (activeTaskId.value !== null && event.taskId !== activeTaskId.value) return;
    progress.value = event;
    logLines.value.push(event.message);
    if (logLines.value.length > 500) logLines.value.splice(0, logLines.value.length - 500);
  });
  onScopeDispose(unsubscribe);

  async function begin(request: InstallRequest): Promise<void> {
    logLines.value = [];
    progress.value = null;
    activeTaskId.value = await mofoxApi.startInstall(request);
  }

  async function retry(): Promise<void> {
    if (activeTaskId.value) await mofoxApi.retryInstall(activeTaskId.value);
  }

  async function cancel(): Promise<void> {
    if (activeTaskId.value) await mofoxApi.cancelInstall(activeTaskId.value);
    activeTaskId.value = null;
    progress.value = null;
    logLines.value = [];
  }

  function reset(): void {
    activeTaskId.value = null;
    progress.value = null;
    logLines.value = [];
  }

  return { activeTaskId, progress, logLines, isInstalling, isFailed, isDone, begin, retry, cancel, reset };
});
