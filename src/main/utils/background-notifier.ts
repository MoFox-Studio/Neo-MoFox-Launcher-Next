/**
 * 后台任务通知器：独立决定「何时值得打扰用户」并弹出系统通知。
 *
 * 通知策略与托盘解耦：只要主窗口没有焦点或不可见（失焦、最小化、
 * 托盘后台等）就通知；窗口在前台聚焦时进度已由界面呈现，通知静默。
 * 模块本身不依赖 electron，系统通知通过 `NotifyPlatform` 注入。
 */

/** 通知器需要探测的主窗口最小接口。 */
export interface NotifyWindowHandle {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
}

/** 系统通知宿主实现；平台不支持时宿主应静默忽略。 */
export interface NotifyPlatform {
  notify(title: string, body: string): void;
}

export interface BackgroundNotifierOptions {
  /** 延迟取主窗口；窗口尚未创建或已销毁时返回 null。 */
  getWindow(): NotifyWindowHandle | null;
  /** 是否允许弹出系统通知；跟随设置中的 trayNotifications。 */
  enabled(): boolean;
  /** 首次转入后台（如关闭到托盘）时的一次性提示文案。 */
  enteredBackgroundNotice: { title: string; body: string };
}

/**
 * 后台任务通知器。
 *
 * 「转入后台」提示每次会话最多出现一次；开关关闭时不消耗这次机会，
 * 用户之后开启通知仍会收到提示。
 */
export class BackgroundNotifier {
  private enteredBackgroundNoticeShown = false;

  constructor(
    private readonly platform: NotifyPlatform,
    private readonly options: BackgroundNotifierOptions,
  ) {}

  /**
   * 当前是否值得弹出通知：主窗口无焦点或不可见。
   *
   * 窗口尚未创建或已销毁（启动/退出阶段）时一律静默，避免退出瞬间的噪音。
   */
  shouldNotify(): boolean {
    const window = this.options.getWindow();
    if (!window || window.isDestroyed()) return false;
    return !window.isFocused() || !window.isVisible();
  }

  /**
   * 弹出后台任务完成通知；前台聚焦或用户关闭开关时静默。
   *
   * @param title - 通知标题。
   * @param body - 通知正文。
   */
  notifyTaskFinished(title: string, body: string): void {
    if (!this.options.enabled() || !this.shouldNotify()) return;
    this.platform.notify(title, body);
  }

  /** 首次转入后台（如关闭到托盘）时的一次性提示；重复调用不再弹出。 */
  notifyEnteredBackground(): void {
    if (this.enteredBackgroundNoticeShown || !this.options.enabled()) return;
    this.enteredBackgroundNoticeShown = true;
    this.platform.notify(
      this.options.enteredBackgroundNotice.title,
      this.options.enteredBackgroundNotice.body,
    );
  }
}
