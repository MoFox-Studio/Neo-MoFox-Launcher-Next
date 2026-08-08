import { defineStore } from 'pinia';
import { ref } from 'vue';

/** 新建实例弹窗由导航栏和页面内快捷入口共享。 */
export const useAddInstanceStore = defineStore('add-instance', () => {
  const open = ref(false);

  function show(): void {
    open.value = true;
  }

  function close(): void {
    open.value = false;
  }

  return { open, show, close };
});
