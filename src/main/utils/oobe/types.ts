import type { MirrorSource } from '../../../shared/domain/mirror';

/**
 * 依赖安装器统一契约。
 *
 * 每个外部依赖（git / python / uv）以独立模块实现该契约；
 * 平台差异由各模块自行根据 `process.platform` 选择分支或加载子模块。
 */
export interface DependencyInstaller {
  /** 安装器 ID，例如 `git`、`python`、`uv`；OOBE 服务据此生成进度事件。 */
  readonly id: string;
  /** 人类可读的展示名，供 OOBE 进度消息使用。 */
  readonly displayName: string;
  /**
   * 探测当前是否已经安装且可执行。
   *
   * @returns 已安装时返回版本字符串；未安装或检测失败时返回 `null`。
   */
  detect(): Promise<string | null>;
  /**
   * 执行安装。
   *
   * @param context - 安装上下文（工作目录、进度回调、取消信号、sudo 密码）。
   * @returns 安装完成后的版本字符串；用于反馈给 UI 与日志。
   */
  install(context: DependencyInstallContext): Promise<string>;
}

/** 依赖安装器共用的执行上下文。 */
export interface DependencyInstallContext {
  /** 临时工作目录，安装器可在此下载/缓存安装包。 */
  workDir: string;
  /** 可选的下载镜像；安装器内部按需选择本类型镜像轮询。 */
  mirrors?: readonly MirrorSource[];
  /**
   * 进度回调：`message` 为人类可读文本，`progress` 为 0..1，无可测量进度时不传。
   */
  onProgress?: (message: string, progress?: number) => void;
  /** 调用方可注入的取消信号。 */
  signal?: AbortSignal;
  /**
   * 用户输入的 sudo 密码（仅 Linux/macOS 需要）。
   * OOBE 服务负责先调用 `sudo -S -v` 验证后再注入，安装器据此通过 stdin 传入 `sudo -S`。
   */
  sudoPassword?: string;
}
