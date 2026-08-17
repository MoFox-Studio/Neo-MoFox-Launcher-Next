import { onBeforeUnmount, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { useWindowTitleStore } from '@/stores/window-title';

// 让页面在窗口栏展示自己的标题；可传响应式源以跟随运行时变化。
export function useWindowTitle(options: {
  title: MaybeRefOrGetter<string>;
  subtitle?: MaybeRefOrGetter<string>;
}): void {
  const store = useWindowTitleStore();

  watch(
    () => [toValue(options.title), toValue(options.subtitle)],
    ([title, subtitle]) => store.commit({ title, subtitle }),
    { immediate: true },
  );

  onBeforeUnmount(() => store.reset());
}
