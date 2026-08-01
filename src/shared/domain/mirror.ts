/** 当前下载实现支持的镜像协议类别。 */
export type MirrorType = 'github' | 'python-ftp';

/** 可供安装器顺序轮询的下载镜像；仅保留地址与类型，不再测量延迟。 */
export interface MirrorSource {
  id: string;
  type: MirrorType;
  name: string;
  baseUrl: string;
}
