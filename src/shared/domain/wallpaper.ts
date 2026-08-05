/** 启动器仅维护一张当前壁纸，类型决定渲染时使用图片或视频元素。 */
export type WallpaperType = 'none' | 'image' | 'video';

/** 主进程暂存的受管壁纸文件；仅在提交后才成为当前壁纸。 */
export interface WallpaperAsset {
  /** 一次性暂存标识，只可用于提交或丢弃当前暂存媒体。 */
  id: string;
  /** 受管目录内的文件名，可作为 `mofox-wallpaper://local/<fileName>` 的资源路径。 */
  fileName: string;
  /** 根据扩展名识别出的媒体类型。 */
  type: Exclude<WallpaperType, 'none'>;
}
