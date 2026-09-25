/**
 * 托盘控制器：负责「关闭到托盘」与「从托盘恢复」的图标与窗口控制。
 *
 * 模块本身不依赖 electron，托盘图标通过 `TrayPlatform` 注入，与 IPC 模块
 * 保持相同的可测试组合根风格；任务通知的打扰策略由独立的
 * `background-notifier` 模块承担，本模块只关心托盘本身。
 */

/** 托盘菜单项；`activate` 由控制器在用户点击时回调。 */
export interface TrayMenuItem {
  label: string;
  activate(): void;
}

/** 宿主注册托盘图标后返回的句柄；销毁后图标从系统托盘移除。 */
export interface TrayBinding {
  destroy(): void;
}

/** 托盘图标宿主实现；由主进程组合根以 Electron 能力填充。 */
export interface TrayPlatform {
  /**
   * 创建托盘图标并绑定菜单。
   *
   * @param options - 悬停提示、图标路径、菜单项与图标左键点击回调。
   * @returns 用于销毁托盘的句柄。
   */
  createTray(options: {
    tooltip: string;
    icon: string | undefined;
    items: TrayMenuItem[];
    /** 平台支持时的托盘图标左键点击（Windows/Linux 部分环境支持）。 */
    onIconActivate?: () => void;
  }): TrayBinding;
}

/** 托盘需要操作的主窗口最小接口。 */
export interface TrayWindowHandle {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  hide(): void;
  show(): void;
  focus(): void;
  restore(): void;
}

export interface TrayControllerOptions {
  /** 延迟取主窗口；窗口尚未创建或已销毁时返回 null。 */
  getWindow(): TrayWindowHandle | null;
  /** 托盘图标路径；解析失败时返回 undefined。 */
  getIcon(): string | undefined;
  /** 托盘悬停提示。 */
  tooltip: string;
  /** 用户从托盘菜单请求退出启动器。 */
  onQuitRequest(): void;
}

const MENU_SHOW_LABEL = '显示主页面';
const MENU_QUIT_LABEL = '退出';

/** 托盘运行态管理器；托盘图标在首次隐藏窗口时惰性创建并复用。 */
export class TrayController {
  private binding?: TrayBinding;

  constructor(
    private readonly platform: TrayPlatform,
    private readonly options: TrayControllerOptions,
  ) {}

  /**
   * 隐藏主窗口并确保托盘图标存在。
   *
   * 托盘创建失败时保持窗口不动并返回 false，让调用方退回真实关闭流程，
   * 避免窗口隐藏后用户失去全部恢复入口。
   *
   * @returns 窗口是否已成功转入托盘后台。
   */
  minimizeToTray(): boolean {
    if (this.isBackgrounded()) return true;
    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) return false;
    try {
      this.ensureBinding();
    } catch {
      return false;
    }
    window.hide();
    return true;
  }

  /** 从托盘恢复主窗口并聚焦；窗口已销毁时静默忽略。 */
  revealMainWindow(): void {
    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** 主窗口是否正处于托盘后台状态（存在且不可见）。 */
  isBackgrounded(): boolean {
    const window = this.options.getWindow();
    return !!window && !window.isDestroyed() && !window.isVisible();
  }

  /** 销毁托盘图标；应用退出或从未创建时安全跳过。 */
  destroy(): void {
    this.binding?.destroy();
    this.binding = undefined;
  }

  /** 托盘图标只创建一次；重复隐藏复用同一实例。 */
  private ensureBinding(): void {
    if (this.binding) return;
    this.binding = this.platform.createTray({
      tooltip: this.options.tooltip,
      icon: this.options.getIcon(),
      items: [
        { label: MENU_SHOW_LABEL, activate: () => this.revealMainWindow() },
        { label: MENU_QUIT_LABEL, activate: () => this.options.onQuitRequest() },
      ],
      onIconActivate: () => this.revealMainWindow(),
    });
  }
}
