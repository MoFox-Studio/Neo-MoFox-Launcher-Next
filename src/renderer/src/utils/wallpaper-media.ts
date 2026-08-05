import type { WallpaperAsset } from '@shared/domain/wallpaper';

/**
 * 生成受控媒体协议 URL；文件名来自主进程，永不拼接用户可控本地路径。
 *
 * @param fileName - 受管目录内的壁纸文件名。
 * @returns 可用于 `<img>`、`<video>` 和 fetch 的媒体 URL。
 */
export function getWallpaperMediaUrl(fileName: string): string {
  return `mofox-wallpaper://local/${encodeURIComponent(fileName)}`;
}

/**
 * 把暂存的受管媒体转换为 File，以复用 WebUI 的 FileReader 和视频取帧逻辑。
 *
 * @param asset - 主进程暂存后返回的媒体描述。
 * @returns 具有协议响应 MIME 类型的浏览器 File。
 */
export async function loadWallpaperFile(asset: WallpaperAsset): Promise<File> {
  const response = await fetch(getWallpaperMediaUrl(asset.fileName));
  if (!response.ok) throw new Error('无法读取暂存壁纸文件');
  const blob = await response.blob();
  return new File([blob], asset.fileName, { type: blob.type });
}
