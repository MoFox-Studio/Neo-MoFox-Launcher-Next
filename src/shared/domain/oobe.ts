import type { LegacyLauncherInfo } from './migration';

/** 单个依赖的安装状态，供 UI 渲染进度列表。 */
export interface OobeDependencyStatus {
  /** 依赖 ID，对应 `DEPENDENCY_INSTALLERS` 中的 `id` 字段。 */
  id: string;
  /** 人类可读展示名，例如 `Git`、`Python`、`uv`。 */
  displayName: string;
  /** 当前状态：未处理 → 安装中 → 已安装/已跳过/失败。 */
  status: 'pending' | 'skipped' | 'installing' | 'installed' | 'failed';
  /** 已安装或检测到的版本号；未安装或失败时省略。 */
  version?: string;
  /** 状态附带的简短说明（失败原因或跳过原因）。 */
  message?: string;
}

/** OOBE 安装进度事件载荷，主进程到渲染进程单向推送。 */
export interface OobeProgress {
  /** 当前阶段：探测中、安装中、已完成、出错。 */
  phase: 'detecting' | 'installing' | 'completed' | 'error';
  /** 当前正在处理的依赖 ID；非安装阶段可省略。 */
  dependencyId?: string;
  /** 人类可读的进度文本。 */
  message: string;
  /** 当前依赖内的 0..1 进度；不可测量时为 -1。 */
  progress: number;
  /** 全部依赖的最新状态汇总。 */
  dependencies: OobeDependencyStatus[];
  /** 累积日志行；供 UI 在失败时展示诊断信息。 */
  logs?: string[];
}

/** OOBE 完成时返回给渲染端的结果摘要。 */
export interface OobeCompletionSummary {
  /** 是否已成功完成（settings.oobeCompleted 已置 true）。 */
  completed: boolean;
  /** 各依赖的最终状态。 */
  dependencies: OobeDependencyStatus[];
  /** 探测到的旧启动器信息；未检测到为 null。 */
  legacy: LegacyLauncherInfo | null;
}
