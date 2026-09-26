/**
 * 终端快捷键：为 xterm 统一构建 `attachCustomKeyEventHandler` 键盘处理器。
 * 拦截 Ctrl+Shift 系列组合（复制 / 粘贴 / 全选 / 搜索 / 清屏）与 Alt+序号切换日志来源，
 * 命中后交给使用方注入的动作执行；未命中的按键原样交还 xterm 处理。
 */

/** 终端快捷键动作集合；由使用方注入自己终端的实现。 */
export interface TerminalShortcutActions {
  /** 复制终端内容（选区或整屏日志的回退策略由实现决定）。 */
  copy(): void;
  /** 读取系统剪贴板并粘贴到终端。 */
  paste(): void;
  /** 全选当前终端内容。 */
  selectAll(): void;
  /** 清空当前日志或清屏。 */
  clear(): void;
  /** 切换搜索开、关并聚焦输入框；仅日志页注入，未注入时 Ctrl+Shift+F 不生效。 */
  search?(): void;
  /** Esc 关闭搜索；返回 `true` 表示本次按键已被消费。 */
  escape?(): boolean;
  /** Alt+序号切换日志来源；返回 `true` 表示本次按键已被消费。 */
  switchTab?(index: number): boolean;
}

/** Alt+序号对应的日志来源下标。 */
const ALT_TAB_INDEX: ReadonlyMap<string, number> = new Map([
  ['Digit1', 0],
  ['Digit2', 1],
]);

/**
 * 判定并执行一次终端快捷键；返回 `true` 表示事件已被消费。
 * 供 xterm 处理器与窗口级兜底监听共用，保证焦点在终端外时快捷键依然可用。
 */
export function handleTerminalShortcut(
  event: KeyboardEvent,
  actions: TerminalShortcutActions,
): boolean {
  // Alt+1 / Alt+2：切换日志来源标签。
  if (actions.switchTab && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    const index = ALT_TAB_INDEX.get(event.code);
    return index !== undefined ? actions.switchTab(index) : false;
  }

  // Esc：搜索打开时优先关闭搜索，其余场景仍交给终端 / shell。
  if (event.key === 'Escape') return actions.escape?.() ?? false;

  // Ctrl+Shift 组合：复制、粘贴、全选、搜索与清屏。
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return false;
  switch (event.code) {
    case 'KeyC':
      actions.copy();
      return true;
    case 'KeyV':
      actions.paste();
      return true;
    case 'KeyA':
      actions.selectAll();
      return true;
    case 'KeyF':
      if (actions.search) {
        actions.search();
        return true;
      }
      return false;
    case 'KeyK':
      actions.clear();
      return true;
    default:
      return false;
  }
}

/**
 * 构建 xterm 的自定义按键处理器，直接传给 `terminal.attachCustomKeyEventHandler`。
 * 返回 `false` 表示按键已被消费：xterm 不会再把它写入 PTY。
 */
export function createTerminalShortcutHandler(
  actions: TerminalShortcutActions,
): (event: KeyboardEvent) => boolean {
  return (event: KeyboardEvent): boolean => {
    // 只在 keydown 阶段处理，避免 keyup / keypress 重复触发动作。
    if (event.type !== 'keydown') return true;
    if (!handleTerminalShortcut(event, actions)) return true;
    // 阻止浏览器默认行为（如原生粘贴命令），并拦下按键避免写入 PTY。
    event.preventDefault();
    return false;
  };
}
