/** 下载任务向界面广播的瞬时进度；未知总大小时 `totalBytes` 可为 0。 */
export interface DownloadProgress {
  url: string;
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
}

/** 分段下载器的资源与重定向限制；省略字段时由下载器应用默认值。 */
export interface RangeDownloadOptions {
  concurrency?: number;
  minChunkBytes?: number;
  maxRedirects?: number;
}
