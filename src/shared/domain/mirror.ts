/** 当前下载实现支持的镜像协议类别。 */
export type MirrorType = 'github' | 'python-ftp';

/** 可供安装器选择的下载镜像；延迟未测量时保持缺失。 */
export interface MirrorSource {
  id: string;
  type: MirrorType;
  name: string;
  baseUrl: string;
  latencyMs?: number;
}

/** 自动选中的镜像及其测量结果产生的时间。 */
export interface MirrorSelection {
  mirror: MirrorSource;
  measuredAt: number;
}
