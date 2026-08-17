import { defineStore } from 'pinia';
import { ref } from 'vue';

// 窗口栏标题状态：路由页面写入自己的标题，由 AppTitleBar 渲染。
export const useWindowTitleStore = defineStore('window-title', () => {
  const title = ref('');
  const subtitle = ref('');

  function commit(next: { title?: string; subtitle?: string }): void {
    title.value = next.title ?? '';
    subtitle.value = next.subtitle ?? '';
  }

  function reset(): void {
    title.value = '';
    subtitle.value = '';
  }

  return { title, subtitle, commit, reset };
});
