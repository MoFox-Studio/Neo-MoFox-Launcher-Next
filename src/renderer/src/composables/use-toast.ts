import { readonly, ref } from 'vue';

/**
 * 全局轻提示（toast）：模块级单例状态，整个渲染进程共享同一条提示。
 * 任何组件、组合式函数或服务都可以直接调用 `showToast`，由挂在 App 根节点的
 * `<AppToast />` 宿主组件统一渲染，无需再通过 props/emit 逐层上报。
 */

/** 默认展示时长（毫秒），与既有页面的轻提示节奏保持一致。 */
const DEFAULT_TOAST_DURATION = 2600;

export interface ToastOptions {
  /** 展示时长（毫秒）；传 `Infinity` 表示常驻，需手动调用 dismiss 关闭。 */
  duration?: number;
}

/** 当前提示文案与可见性；被 AppToast 宿主消费。 */
const message = ref('');
const visible = ref(false);

let hideTimer: ReturnType<typeof setTimeout> | null = null;

function dismiss(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  visible.value = false;
}

/** 弹出一条轻提示；重复调用会立即替换文案并重置计时。 */
function showToast(text: string, options: ToastOptions = {}): void {
  const duration = options.duration ?? DEFAULT_TOAST_DURATION;
  message.value = text;
  visible.value = true;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = duration === Number.POSITIVE_INFINITY ? null : setTimeout(dismiss, duration);
}

/**
 * 在组件中使用全局轻提示；状态为只读，写入统一走 `show` / 全局 `showToast`。
 * 全局单例自带生命周期，组件卸载后无需手动清理计时器。
 */
export function useToast() {
  return {
    message: readonly(message),
    visible: readonly(visible),
    show: showToast,
    dismiss,
  };
}

export { showToast, dismiss };
