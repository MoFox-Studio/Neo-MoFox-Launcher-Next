import type { GithubRelease } from './github';

/** 单个 Git 提交的展示信息；`hash` 为短哈希，`fullHash` 为完整 SHA。 */
export interface MofoxCommit {
  hash: string;
  fullHash: string;
  message: string;
  /** Git 输出的 ISO 8601 时间字符串。 */
  date: string;
  isCurrent: boolean;
}

/** 当前 HEAD 提交摘要；无法读取时为 `null`。 */
export interface MofoxCurrentCommit {
  hash: string;
  message: string;
  date: string;
}

/**
 * 主程序（Neo-MoFox）的版本与更新信息。
 *
 * `branches` 来自远程分支 API（含当前分支），`commits` 来自本地 `git log`；
 * `hasUpdate` 表示本地落后于远程跟踪分支，可通过更新拉取最新代码。
 */
export interface MofoxUpdateInfo {
  /** 安装目录是否为有效 Git 仓库。 */
  isRepository: boolean;
  /** 当前检出分支名；非仓库时为 `null`。 */
  branch: string | null;
  /** 当前 HEAD 提交摘要；非仓库或读取失败时为 `null`。 */
  currentCommit: MofoxCurrentCommit | null;
  /** 远程可用分支名列表。 */
  branches: string[];
  /** 本地提交历史（最新在前）。 */
  commits: MofoxCommit[];
  /** 本地是否落后于远程跟踪分支（可更新）。 */
  hasUpdate: boolean;
  /** 本地落后于远程的提交数。 */
  behindCount: number;
  /** 本地领先于远程的提交数。 */
  aheadCount: number;
}

/** 平台适配器的版本与更新信息；未安装平台时 `installed` 为 `false`。 */
export interface PlatformUpdateInfo {
  installed: boolean;
  /** 当前安装的平台版本；手动导入且未知时为 `null`。 */
  currentVersion: string | null;
  /** 平台仓库的全部 Release 列表（含预发布与旧版本）。 */
  releases: GithubRelease[];
}

/** 更新操作向界面推送的进度事件。 */
export interface UpdateProgressEvent {
  instanceId: string;
  /** 操作阶段标识（如 `switch-branch`、`checkout-commit`、`update-mofox`、`update-platform`）。 */
  phase: string;
  /** 当前阶段内的 0..1 进度；无法测量时为 -1。 */
  percent: number;
  message: string;
  error?: string;
}
