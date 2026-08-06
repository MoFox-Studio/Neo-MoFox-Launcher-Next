import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref } from 'vue';
import type { InstallProgressEvent, InstallRequest } from '@shared/domain/install';
import { mofoxApi } from '@/services/mofox-api';

/**
 * 安装任务驻留在仓库而非向导视图，离开页面后仍可保留后台进度与日志。
 */
export const useInstallStore = defineStore('install', () => {
  // 活动任务、最新进度与有限长度的安装日志构成向导的响应式数据源。
  const activeTaskId = ref<string | null>(null);
  const progress = ref<InstallProgressEvent | null>(null);
  const logLines = ref<string[]>([]);

  const isInstalling = computed(
    () => progress.value !== null && progress.value.status === 'running',
  );
  const isFailed = computed(() => progress.value?.status === 'failed');
  const isDone = computed(() => progress.value?.status === 'done');

  // 只接收当前任务事件，并限制日志缓存以控制长期内存占用。
  const unsubscribe = mofoxApi.on('install-progress', (event) => {
    if (activeTaskId.value !== null && event.taskId !== activeTaskId.value) return;
    progress.value = event;
    logLines.value.push(event.message);
    if (logLines.value.length > 500) logLines.value.splice(0, logLines.value.length - 500);
  });
  onScopeDispose(unsubscribe);

  async function begin(request: InstallRequest): Promise<void> {
    // 新任务启动前清空上次运行残留，任务 ID 由异步 API 返回。
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

  return {
    activeTaskId,
    progress,
    logLines,
    isInstalling,
    isFailed,
    isDone,
    begin,
    retry,
    cancel,
    reset,
  };
});
