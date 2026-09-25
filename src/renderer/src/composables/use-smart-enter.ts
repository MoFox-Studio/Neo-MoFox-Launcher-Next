import { onBeforeUnmount, onMounted, type Ref } from 'vue';

/**
 * 智能回车：在向导表单里按 Enter 自动聚焦下一个输入框；已经是最后一个输入框
 * 或焦点不在任何输入框上时，触发主操作（对应“继续/开始安装”按钮）。
 * 与旧启动器安装向导的回车体验保持一致。
 */
export interface SmartEnterOptions {
  /** 在该元素范围内查找可聚焦的输入框。 */
  target: Ref<HTMLElement | null>;
  /** 是否响应回车；弹窗打开、任务执行中等场景返回 false 直接忽略。 */
  enabled: () => boolean;
  /** 焦点已是最后一个输入框或不在任何输入框上时执行的主操作。 */
  onPrimary: () => void;
  /**
   * 额外的可见性过滤。折叠区块（grid 0fr + overflow hidden）里的输入框仍参与
   * 布局，offsetParent 不为 null，需要组件按自身结构排除。
   */
  isVisible?: (element: HTMLInputElement | HTMLSelectElement) => boolean;
}

// Material Web 的 select 组件自己用 Enter 打开菜单且不阻止事件冒泡，这里必须让行。
const SELF_MANAGED_SELECT_SELECTOR = 'md-outlined-select, md-filled-select';

export function useSmartEnter(options: SmartEnterOptions): void {
  // 记录“刚用 Enter 打开了下拉菜单”：在菜单里选定后自动衔接回车链路。
  let enterOpenedSelect = false;

  const FOCUSABLE_SELECTOR = [
    'input:not([type="checkbox"]):not([type="hidden"]):not([type="radio"])',
    'select',
    SELF_MANAGED_SELECT_SELECTOR,
  ].join(', ');

  function collectFocusables(root: HTMLElement): Array<HTMLInputElement | HTMLSelectElement> {
    return Array.from(
      root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => {
      // md-select 没有 disabled 问题时返回 undefined，视为可用。
      if ((element as HTMLSelectElement).disabled || element.offsetParent === null) return false;
      return options.isVisible ? options.isVisible(element) : true;
    });
  }

  function advanceFrom(current: Element, event?: KeyboardEvent): void {
    const root = options.target.value;
    if (!root) return;
    const focusables = collectFocusables(root);
    const index = focusables.indexOf(current as HTMLInputElement | HTMLSelectElement);
    if (index >= 0 && index < focusables.length - 1) {
      event?.preventDefault();
      focusables[index + 1]?.focus();
      return;
    }
    // 已是最后一个输入框，或焦点不在输入框上：执行主操作。
    event?.preventDefault();
    options.onPrimary();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!options.enabled()) return;
    const root = options.target.value;
    if (!root) return;

    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    // 按钮与链接保持原生行为：Enter 触发点击。
    if (active.tagName === 'BUTTON' || active.tagName === 'A') return;
    if (active.closest(SELF_MANAGED_SELECT_SELECTOR)) {
      // 下拉框用 Enter 打开菜单；记录状态，等选定后自动衔接回车链路。
      enterOpenedSelect = true;
      return;
    }
    // 多行文本框保留换行语义；checkbox/radio 交给原生按键行为。
    if (active.tagName === 'TEXTAREA') return;
    if (active.tagName === 'INPUT') {
      const type = (active as HTMLInputElement).type;
      if (type === 'checkbox' || type === 'radio' || type === 'hidden') return;
    }

    advanceFrom(active, event);
  }

  // 下拉框选定后 change 会冒泡到 document；若菜单是刚用 Enter 打开的，继续回车链路。
  function handleSelectChange(event: Event): void {
    if (!enterOpenedSelect) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(SELF_MANAGED_SELECT_SELECTOR)) return;
    if (!options.target.value?.contains(target)) return;
    if (!options.enabled()) return;
    enterOpenedSelect = false;
    // Tab 可能进入折叠区块里的下拉框：不可见的下拉框选定后不做跳转。
    const focusables = collectFocusables(options.target.value);
    if (!focusables.includes(target as HTMLInputElement | HTMLSelectElement)) return;
    advanceFrom(target);
  }

  // 菜单未产生选定就关闭（Esc、点击外部）时清除状态，避免之后的 change 误触发跳转。
  // select 重新派发的 closed 事件不冒泡，但捕获阶段仍会经过 document。
  function handleMenuClosed(): void {
    enterOpenedSelect = false;
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown);
    document.addEventListener('change', handleSelectChange);
    document.addEventListener('closed', handleMenuClosed, true);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('change', handleSelectChange);
    document.removeEventListener('closed', handleMenuClosed, true);
  });
}
