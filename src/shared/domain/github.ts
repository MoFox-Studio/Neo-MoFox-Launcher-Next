/**
 * GitHub 远程数据的跨进程共享类型。
 *
 * 主进程通过镜像轮询解析 GitHub API，渲染层只消费这里声明的结构，
 * 避免把镜像源与请求实现细节泄漏给界面。
 */

/** GitHub Release 资产；`digest` 仅在发布元数据提供校验和时存在。 */
export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  digest?: string;
}

/** GitHub Release 元数据；仅保留渲染层需要展示或选择资产的字段。 */
export interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  prerelease: boolean;
  assets: GithubReleaseAsset[];
}

/** 远程分支列表中的单个分支；`commit` 为该分支最新提交的完整 SHA。 */
export interface GithubBranchInfo {
  name: string;
  commit: string;
}
