import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_WALLPAPER_BLUR,
  DEFAULT_WALLPAPER_OPACITY,
  type LauncherSettings,
} from '../../shared/domain/settings';
import type { WallpaperAsset, WallpaperType } from '../../shared/domain/wallpaper';
import { MofoxError } from '../../shared/domain/error';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const WALLPAPER_FILE_NAME = /^wallpaper-[a-f0-9-]+\.(?:jpe?g|png|webp|mp4|webm)$/i;
const STAGED_FILE_NAME = /^staged-[a-f0-9-]+\.(?:jpe?g|png|webp|mp4|webm)$/i;

interface WallpaperSettingsStore {
  /** 读取当前完整设置快照。 */
  get(): Promise<LauncherSettings>;
  /** 原子合并并持久化局部设置字段。 */
  update(patch: Partial<LauncherSettings>): Promise<LauncherSettings>;
}

/** 暂存媒体的内部完整信息，磁盘路径永不通过 IPC 暴露给渲染进程。 */
interface StagedWallpaper extends WallpaperAsset {
  /** 应用数据目录中暂存副本的绝对路径。 */
  path: string;
}

/**
 * 管理单张受管壁纸的暂存、提交和清理。
 * 渲染器只会获得受管文件名，无法把任意本地路径交给媒体协议读取。
 */
export class WallpaperService {
  private readonly directory: string;
  private readonly staged = new Map<string, StagedWallpaper>();

  /**
   * @param dataDirectory - Electron `userData` 目录的绝对路径。
   * @param settings - 用于提交当前壁纸元数据的持久化设置仓库。
   */
  constructor(
    dataDirectory: string,
    private readonly settings: WallpaperSettingsStore,
  ) {
    this.directory = join(dataDirectory, 'wallpapers');
  }

  /**
   * 校验并复制源文件到不可持久引用的暂存区，等待渲染端完成取色后再提交。
   *
   * @param sourcePath - 仅由主进程文件对话框返回的用户源文件绝对路径。
   * @returns 不含本地绝对路径的暂存媒体描述。
   * @throws {MofoxError} 文件格式、大小或可读性不满足要求时抛出。
   */
  async stage(sourcePath: string): Promise<WallpaperAsset> {
    if (!isAbsolute(sourcePath)) {
      throw new MofoxError('INVALID_ARGUMENT', 'Wallpaper path must be absolute');
    }
    const extension = extname(sourcePath).toLowerCase();
    const type = getWallpaperType(extension);
    const sourceStat = await this.getRegularFileStat(sourcePath);
    const maxBytes = type === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (sourceStat.size > maxBytes) {
      throw new MofoxError(
        'INVALID_ARGUMENT',
        `${type === 'image' ? 'Image' : 'Video'} wallpapers must not exceed ${maxBytes / 1024 / 1024} MiB`,
      );
    }

    const id = randomUUID();
    const fileName = `staged-${id}${extension}`;
    const path = join(this.directory, fileName);
    await mkdir(this.directory, { recursive: true });
    try {
      await copyFile(sourcePath, path);
    } catch (error) {
      throw new MofoxError(
        'IO_ERROR',
        `Unable to copy wallpaper: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const asset: StagedWallpaper = { id, fileName, type, path };
    this.staged.set(id, asset);
    return { id: asset.id, fileName: asset.fileName, type: asset.type };
  }

  /**
   * 将已完成渲染端取色的暂存媒体原子提升为当前壁纸，并持久化其受管文件名。
   *
   * @param id - `stage()` 返回的一次性暂存标识。
   * @returns 提交后的完整设置快照。
   * @throws {MofoxError} 暂存媒体不存在时抛出 `NOT_FOUND`。
   */
  async commit(id: string): Promise<LauncherSettings> {
    const staged = this.staged.get(id);
    if (!staged) throw new MofoxError('NOT_FOUND', 'Wallpaper staging asset was not found');

    const extension = extname(staged.fileName).toLowerCase();
    const fileName = `wallpaper-${randomUUID()}${extension}`;
    const path = join(this.directory, fileName);
    const current = await this.settings.get();
    try {
      await rename(staged.path, path);
      const updated = await this.settings.update({
        wallpaperType: staged.type,
        wallpaperFileName: fileName,
        ...(current.wallpaperType === 'none'
          ? {
              wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
              wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
            }
          : {}),
      });
      this.staged.delete(id);
      if (current.wallpaperFileName && current.wallpaperFileName !== fileName) {
        await this.removeManagedFile(current.wallpaperFileName);
      }
      return updated;
    } catch (error) {
      this.staged.delete(id);
      await this.removePath(path);
      throw error;
    }
  }

  /**
   * 丢弃取色失败、用户取消或未提交的暂存文件。
   *
   * @param id - `stage()` 返回的一次性暂存标识；已不存在时视为幂等成功。
   */
  async discard(id: string): Promise<void> {
    const staged = this.staged.get(id);
    if (!staged) return;
    this.staged.delete(id);
    await this.removePath(staged.path);
  }

  /**
   * 删除当前壁纸并将所有壁纸显示设置恢复为默认值。
   *
   * @returns 删除后的完整设置快照。
   */
  async remove(): Promise<LauncherSettings> {
    const current = await this.settings.get();
    const updated = await this.settings.update({
      wallpaperType: 'none',
      wallpaperFileName: '',
      wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
      wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
    });
    if (current.wallpaperFileName) await this.removeManagedFile(current.wallpaperFileName);
    return updated;
  }

  /**
   * 返回当前或正在取色的受管媒体路径；协议层不能通过猜测文件名读取目录中其他文件。
   *
   * @param fileName - 自定义协议 URL 中请求的受管文件名。
   * @returns 可由主进程读取的绝对文件路径。
   * @throws {MofoxError} 文件名未处于当前或暂存白名单时抛出 `NOT_FOUND`。
   */
  async resolveMediaPath(fileName: string): Promise<string> {
    if (!isManagedFileName(fileName))
      throw new MofoxError('NOT_FOUND', 'Wallpaper asset was not found');
    const current = await this.settings.get();
    const isCurrent = current.wallpaperFileName === fileName;
    const isStaged = [...this.staged.values()].some((asset) => asset.fileName === fileName);
    if (!isCurrent && !isStaged) throw new MofoxError('NOT_FOUND', 'Wallpaper asset was not found');
    const path = join(this.directory, fileName);
    await this.getRegularFileStat(path);
    return path;
  }

  /** 确认文件存在且不是目录、套接字等非常规节点。 */
  private async getRegularFileStat(path: string) {
    try {
      const info = await stat(path);
      if (!info.isFile())
        throw new MofoxError('INVALID_ARGUMENT', 'Wallpaper must be a regular file');
      return info;
    } catch (error) {
      if (error instanceof MofoxError) throw error;
      throw new MofoxError(
        'NOT_FOUND',
        `Wallpaper file is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** 仅删除正式受管命名的文件，避免配置损坏时删除目录内任意路径。 */
  private async removeManagedFile(fileName: string): Promise<void> {
    if (!WALLPAPER_FILE_NAME.test(fileName)) return;
    await this.removePath(join(this.directory, basename(fileName)));
  }

  /** 清理失败不影响已经成功提交的设置或壁纸替换。 */
  private async removePath(path: string): Promise<void> {
    try {
      await rm(path, { force: true });
    } catch {
      // 壁纸清理失败不应撤销已提交的设置；遗留受管文件下次替换时可被覆盖或手动清理。
    }
  }
}

/** 从受支持的文件扩展名归类媒体类型。 */
function getWallpaperType(extension: string): Exclude<WallpaperType, 'none'> {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  throw new MofoxError(
    'INVALID_ARGUMENT',
    'Supported wallpaper formats: JPG, PNG, WebP, MP4, WebM',
  );
}

/** 判断文件名是否符合暂存或正式受管媒体的严格命名规则。 */
function isManagedFileName(fileName: string): boolean {
  return WALLPAPER_FILE_NAME.test(fileName) || STAGED_FILE_NAME.test(fileName);
}
