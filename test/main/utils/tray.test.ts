import { describe, expect, it, vi } from 'vitest';
import {
  TrayController,
  type TrayBinding,
  type TrayMenuItem,
  type TrayPlatform,
  type TrayWindowHandle,
} from '../../../src/main/utils/tray';

/** 验证关闭到托盘、托盘菜单注册与窗口恢复控制。 */

interface PlatformHarness {
  platform: TrayPlatform;
  createTray: ReturnType<typeof vi.fn>;
  /** 最近一次注册托盘时的菜单项，可直接触发点击回调。 */
  items: TrayMenuItem[];
  /** 最近一次注册托盘时的图标左键回调。 */
  iconActivate?: () => void;
  failTray: boolean;
}

function createPlatform(): PlatformHarness {
  const harness: PlatformHarness = {
    createTray: vi.fn(),
    items: [],
    failTray: false,
    platform: undefined as unknown as TrayPlatform,
  };
  harness.createTray.mockImplementation(
    (options: { tooltip: string; items: TrayMenuItem[]; onIconActivate?: () => void }) => {
      if (harness.failTray) throw new Error('no tray available');
      harness.items = options.items;
      harness.iconActivate = options.onIconActivate;
      const binding: TrayBinding = { destroy: vi.fn() };
      return binding;
    },
  );
  harness.platform = {
    createTray: harness.createTray,
  };
  return harness;
}

function createWindow(overrides: Partial<TrayWindowHandle> = {}): TrayWindowHandle & {
  hide: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
} {
  // 模拟真实窗口的可见性状态：hide 后不可见，show 后恢复可见。
  let visible = true;
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    hide: vi.fn(() => {
      visible = false;
    }),
    show: vi.fn(() => {
      visible = true;
    }),
    focus: vi.fn(),
    restore: vi.fn(),
    ...overrides,
  };
}

describe('TrayController', () => {
  it('hides the window to tray and registers the menu once', () => {
    const harness = createPlatform();
    const window = createWindow();
    const controller = new TrayController(harness.platform, {
      getWindow: () => window,
      getIcon: () => 'icon.ico',
      tooltip: 'Neo-MoFox 启动器',
      onQuitRequest: () => undefined,
    });

    expect(controller.minimizeToTray()).toBe(true);
    expect(window.hide).toHaveBeenCalledOnce();
    expect(harness.createTray).toHaveBeenCalledOnce();
    expect(harness.createTray.mock.calls[0][0]).toMatchObject({
      tooltip: 'Neo-MoFox 启动器',
      icon: 'icon.ico',
    });
    expect(harness.items.map((item) => item.label)).toEqual(['显示主页面', '退出']);

    // 重复关闭复用同一托盘实例，不重复隐藏。
    window.show();
    expect(controller.minimizeToTray()).toBe(true);
    expect(window.hide).toHaveBeenCalledTimes(2);
    expect(harness.createTray).toHaveBeenCalledOnce();
  });

  it('falls back to a real close when the tray cannot be created', () => {
    const harness = createPlatform();
    harness.failTray = true;
    const window = createWindow();
    const controller = new TrayController(harness.platform, {
      getWindow: () => window,
      getIcon: () => undefined,
      tooltip: 'Neo-MoFox 启动器',
      onQuitRequest: () => undefined,
    });

    expect(controller.minimizeToTray()).toBe(false);
    expect(window.hide).not.toHaveBeenCalled();
  });

  it('restores and focuses the window from the tray menu and icon click', () => {
    const harness = createPlatform();
    const window = createWindow({ isMinimized: vi.fn(() => true) });
    const onQuitRequest = vi.fn();
    new TrayController(harness.platform, {
      getWindow: () => window,
      getIcon: () => undefined,
      tooltip: 'Neo-MoFox 启动器',
      onQuitRequest,
    }).minimizeToTray();

    harness.items[0]?.activate();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(onQuitRequest).not.toHaveBeenCalled();

    harness.iconActivate?.();
    expect(window.show).toHaveBeenCalledTimes(2);

    harness.items[1]?.activate();
    expect(onQuitRequest).toHaveBeenCalledOnce();
  });

  it('destroys the tray binding and is safe without a window', () => {
    const harness = createPlatform();
    const controller = new TrayController(harness.platform, {
      getWindow: () => null,
      getIcon: () => undefined,
      tooltip: 'Neo-MoFox 启动器',
      onQuitRequest: () => undefined,
    });

    expect(controller.minimizeToTray()).toBe(false);
    expect(controller.isBackgrounded()).toBe(false);

    const window = createWindow();
    const owning = new TrayController(harness.platform, {
      getWindow: () => window,
      getIcon: () => undefined,
      tooltip: 'Neo-MoFox 启动器',
      onQuitRequest: () => undefined,
    });
    owning.minimizeToTray();
    expect(window.isVisible()).toBe(false);
    owning.destroy();
    const binding = harness.createTray.mock.results[0]?.value as TrayBinding;
    expect(binding.destroy).toHaveBeenCalledOnce();

    // 重复销毁安全跳过。
    owning.destroy();
    expect(binding.destroy).toHaveBeenCalledOnce();
  });
});
