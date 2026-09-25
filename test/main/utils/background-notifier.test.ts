import { describe, expect, it, vi } from 'vitest';
import {
  BackgroundNotifier,
  type NotifyWindowHandle,
} from '../../../src/main/utils/background-notifier';

/** 验证后台通知的门控规则：窗口无焦点或不可见即通知，前台聚焦时静默。 */

interface WindowState {
  destroyed?: boolean;
  visible?: boolean;
  focused?: boolean;
}

function createWindow(state: WindowState = {}): NotifyWindowHandle {
  return {
    isDestroyed: vi.fn(() => state.destroyed ?? false),
    isVisible: vi.fn(() => state.visible ?? true),
    isFocused: vi.fn(() => state.focused ?? true),
  };
}

function createNotifier(window: NotifyWindowHandle | null, enabled = true) {
  const notify = vi.fn();
  const notifier = new BackgroundNotifier(
    { notify },
    {
      getWindow: () => window,
      enabled: () => enabled,
      enteredBackgroundNotice: { title: 'Neo-MoFox 启动器', body: '后台运行提示' },
    },
  );
  return { notify, notifier };
}

describe('BackgroundNotifier', () => {
  it('stays silent while the window is focused and visible', () => {
    const { notify, notifier } = createNotifier(createWindow());

    expect(notifier.shouldNotify()).toBe(false);
    notifier.notifyTaskFinished('实例安装完成', '「demo」安装完成');
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies when the window loses focus', () => {
    const { notify, notifier } = createNotifier(createWindow({ focused: false }));

    notifier.notifyTaskFinished('实例安装完成', '「demo」安装完成');
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith('实例安装完成', '「demo」安装完成');
  });

  it('notifies when the window is hidden in the tray', () => {
    const { notify, notifier } = createNotifier(createWindow({ visible: false, focused: false }));

    notifier.notifyTaskFinished('依赖更新完成', '「demo」已完成');
    expect(notify).toHaveBeenCalledOnce();
  });

  it('stays silent when notifications are disabled', () => {
    const { notify, notifier } = createNotifier(createWindow({ focused: false }), false);

    notifier.notifyTaskFinished('实例安装失败', '「demo」失败');
    notifier.notifyEnteredBackground();
    expect(notify).not.toHaveBeenCalled();
  });

  it('stays silent without a live window', () => {
    const missing = createNotifier(null);
    missing.notifier.notifyTaskFinished('实例安装完成', '「demo」安装完成');
    expect(missing.notify).not.toHaveBeenCalled();

    const destroyed = createNotifier(createWindow({ destroyed: true }));
    destroyed.notifier.notifyTaskFinished('实例安装完成', '「demo」安装完成');
    expect(destroyed.notify).not.toHaveBeenCalled();
  });

  it('shows the entered-background notice only once per session', () => {
    const { notify, notifier } = createNotifier(createWindow({ visible: false, focused: false }));

    notifier.notifyEnteredBackground();
    notifier.notifyEnteredBackground();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith('Neo-MoFox 启动器', '后台运行提示');
  });

  it('does not consume the notice opportunity while disabled', () => {
    let enabled = false;
    const notify = vi.fn();
    const notifier = new BackgroundNotifier(
      { notify },
      {
        getWindow: () => createWindow({ visible: false, focused: false }),
        enabled: () => enabled,
        enteredBackgroundNotice: { title: 'T', body: 'B' },
      },
    );

    notifier.notifyEnteredBackground();
    expect(notify).not.toHaveBeenCalled();

    enabled = true;
    notifier.notifyEnteredBackground();
    expect(notify).toHaveBeenCalledOnce();
  });
});
