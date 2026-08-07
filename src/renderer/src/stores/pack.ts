import { defineStore } from 'pinia';
import { onScopeDispose, ref } from 'vue';
import type { PackProgressEvent } from '@shared/domain/pack';
import { mofoxApi } from '@/services/mofox-api';

// 整合包操作的进度与日志状态：导出/导入/校验通过统一事件总线上报。
export const usePackStore = defineStore('pack', () => {
  const percent = ref(0);
  const messages = ref<string[]>([]);
  const active = ref(false);

  const unsubscribe = mofoxApi.on('pack-progress', (event: PackProgressEvent) => {
    messages.value.push(event.message);
    if (event.percent >= 0) {
      percent.value = event.percent;
    }
    if (event.percent >= 100) {
      active.value = false;
    }
  });
  onScopeDispose(() => {
    unsubscribe();
  });

  function reset(): void {
    percent.value = 0;
    messages.value = [];
    active.value = true;
  }

  return { percent, messages, active, reset };
});