/**
 * 启动器自身版本与更新的跨进程共享类型。
 *
 * 本地构建信息来源于打包阶段写入 resources/version.json 的版本号文件，
 * 更新检查通过 GitHub Releases 查询最新发行版并与本地构建比较；
 * 渲染层只消费这里声明的结构，不接触镜像与网络实现细节。
 */

/** 启动器构建渠道：`dev` 为源码运行或本地打包，`nightly` 为每夜构建。 */
export type LauncherBuildChannel = 'dev' | 'nightly';

/** 本地构建的版本信息；空字符串表示该字段在当前构建中不可用。 */
export interface LauncherBuildInfo {
  /**
   * 构建版本号；每夜构建即构建日期（YYYYMMDD，如 `20260926`），
   * 开发构建与未声明版本号的包回退为 package.json 的应用版本。
   */
  version: string;
  channel: LauncherBuildChannel;
  /** 每夜构建日期（YYYYMMDD）；开发构建为空。 */
  buildDate: string;
  /** 构建对应的发布标签，如 `nightly-20260926`；无对应发布时为空。 */
  tag: string;
  /** 构建对应的短提交哈希；未知时为空。 */
  commit: string;
}

/** 远端更新检查结果：无论是否可用更新都携带当前构建信息供界面展示。 */
export interface LauncherUpdateInfo {
  /** 是否存在比当前构建更新的发行版。 */
  updateAvailable: boolean;
  /** 发起检查时的本地构建信息。 */
  current: LauncherBuildInfo;
  /** 远端最新版本的显示名（发布标题或标签）；无可用更新时为空字符串。 */
  latestVersion: string;
  /** 远端最新版本的发布标签；无可用更新时为空字符串。 */
  latestTag: string;
  /** 远端每夜构建日期（YYYYMMDD）；非每夜发行版为空字符串。 */
  latestBuildDate: string;
  /** 发行版页面地址，用于跳转系统浏览器查看说明与下载。 */
  releaseUrl: string;
  /** 发行说明 Markdown 原文；渲染前必须经过净化处理。 */
  releaseNotes: string;
  /** 发行时间 ISO 字符串；未知时为空字符串。 */
  publishedAt: string;
}

/** 当前构建对应发行版的更新日志；`found` 为 false 表示该构建没有对应的已发布发行版。 */
export interface LauncherReleaseNotes {
  found: boolean;
  /** 发行标签；与本地构建的 tag 一致。 */
  tag: string;
  /** 发行版显示名（发布标题或标签）。 */
  name: string;
  /** 发行说明 Markdown 原文；渲染前必须经过净化处理。 */
  notes: string;
  /** 发行时间 ISO 字符串；未知时为空字符串。 */
  publishedAt: string;
  /** 发行版页面地址，用于跳转系统浏览器查看。 */
  url: string;
}
