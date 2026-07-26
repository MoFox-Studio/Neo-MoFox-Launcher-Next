export interface DownloadProgress {
  url: string;
  receivedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
}

export interface RangeDownloadOptions {
  concurrency?: number;
  minChunkBytes?: number;
  maxRedirects?: number;
}
