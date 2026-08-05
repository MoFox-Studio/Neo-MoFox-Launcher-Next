/** 单个采样像素或 K-means 聚类中心的 RGB 分量。 */
interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const WALLPAPER_COLORS_KEY = 'mofox_wallpaper_colors';

/** 将 RGB 分量转换为小写六位十六进制颜色。 */
function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** 按 WebUI 的 Rec. 601 权重计算 0..1 的近似亮度。 */
function getLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** 计算两个 RGB 颜色的欧氏距离，用于最近中心匹配。 */
function colorDistance(first: RgbColor, second: RgbColor): number {
  const redDifference = first.r - second.r;
  const greenDifference = first.g - second.g;
  const blueDifference = first.b - second.b;
  return Math.sqrt(
    redDifference * redDifference +
      greenDifference * greenDifference +
      blueDifference * blueDifference,
  );
}

/**
 * WebUI 同款简化 K-means：确定性步进初始化，最多迭代十次。
 *
 * @param pixels - 已滤除透明、过暗及过亮颜色的采样像素。
 * @param clusterCount - 需要的主色数量。
 * @returns 聚类后的 RGB 中心。
 */
function kMeansClustering(pixels: RgbColor[], clusterCount: number): RgbColor[] {
  if (pixels.length === 0) return [];
  const step = Math.floor(pixels.length / clusterCount);
  const centroids = Array.from({ length: clusterCount }, (_, index) => ({
    ...pixels[Math.min(index * step, pixels.length - 1)],
  }));

  for (let iteration = 0; iteration < 10; iteration += 1) {
    const clusters: RgbColor[][] = Array.from({ length: clusterCount }, () => []);
    for (const pixel of pixels) {
      let minimumDistance = Infinity;
      let clusterIndex = 0;
      for (let index = 0; index < clusterCount; index += 1) {
        const distance = colorDistance(pixel, centroids[index]);
        if (distance < minimumDistance) {
          minimumDistance = distance;
          clusterIndex = index;
        }
      }
      clusters[clusterIndex].push(pixel);
    }

    let changed = false;
    for (let index = 0; index < clusterCount; index += 1) {
      const cluster = clusters[index];
      if (cluster.length === 0) continue;
      const centroid = {
        r: Math.round(cluster.reduce((sum, pixel) => sum + pixel.r, 0) / cluster.length),
        g: Math.round(cluster.reduce((sum, pixel) => sum + pixel.g, 0) / cluster.length),
        b: Math.round(cluster.reduce((sum, pixel) => sum + pixel.b, 0) / cluster.length),
      };
      if (colorDistance(centroid, centroids[index]) > 1) changed = true;
      centroids[index] = centroid;
    }
    if (!changed) break;
  }

  return centroids;
}

/**
 * 从图片文件中提取 WebUI 同款的六个主色。
 *
 * 图片会缩放到最大边 200px，每四个像素采样一次，并排除透明、过暗与过亮像素。
 * 有效像素不足目标色数时会拒绝，这与 WebUI 的壁纸导入行为一致。
 *
 * @param file - 图片文件或从视频帧生成的 JPEG 文件。
 * @param colorCount - 需要生成的主色数量，默认值为 6。
 * @returns 按饱和度和中间亮度优先级排序的十六进制颜色。
 */
export function extractColorsFromImage(file: File, colorCount = 6): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('无法获取 Canvas 上下文'));
            return;
          }
          const scale = Math.min(200 / image.width, 200 / image.height, 1);
          canvas.width = image.width * scale;
          canvas.height = image.height * scale;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const pixels: RgbColor[] = [];
          for (let index = 0; index < imageData.data.length; index += 16) {
            const red = imageData.data[index];
            const green = imageData.data[index + 1];
            const blue = imageData.data[index + 2];
            const alpha = imageData.data[index + 3];
            const luminance = getLuminance(red, green, blue);
            if (alpha < 128 || luminance < 0.1 || luminance > 0.9) continue;
            pixels.push({ r: red, g: green, b: blue });
          }
          if (pixels.length < colorCount) {
            reject(new Error('图片颜色数量不足'));
            return;
          }
          resolve(
            kMeansClustering(pixels, colorCount)
              .map((color) => {
                const maximum = Math.max(color.r, color.g, color.b);
                const minimum = Math.min(color.r, color.g, color.b);
                const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
                const luminance = getLuminance(color.r, color.g, color.b);
                return {
                  color,
                  score: saturation * (1 - Math.abs(luminance - 0.5)),
                };
              })
              .sort((first, second) => second.score - first.score)
              .map(({ color }) => rgbToHex(color.r, color.g, color.b)),
          );
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('图片加载失败'));
      image.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 将最新壁纸的调色板保存到与 WebUI 相同的浏览器本地存储键。 */
export function saveWallpaperColors(colors: string[]): void {
  try {
    localStorage.setItem(WALLPAPER_COLORS_KEY, JSON.stringify(colors));
  } catch {
    // 隐私模式或受限存储不可用时，壁纸导入仍可继续完成。
  }
}

/** 从 WebUI 兼容的本地存储键恢复上次成功或失败导入的调色板。 */
export function loadWallpaperColors(): string[] | null {
  try {
    const stored = localStorage.getItem(WALLPAPER_COLORS_KEY);
    if (!stored) return null;
    const colors = JSON.parse(stored);
    return Array.isArray(colors) && colors.every((color) => typeof color === 'string') ? colors : null;
  } catch {
    return null;
  }
}

/** 删除 WebUI 兼容的本地壁纸调色板缓存。 */
export function clearWallpaperColors(): void {
  try {
    localStorage.removeItem(WALLPAPER_COLORS_KEY);
  } catch {
    // localStorage 不可用不应影响删除当前壁纸。
  }
}
