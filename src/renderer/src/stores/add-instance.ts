import { defineStore } from 'pinia';
import { ref } from 'vue';

// 新建实例弹窗的全局可见性：由导航栏与各视图的“新建实例”入口共享。
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