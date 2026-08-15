import type { WallpaperType } from './wallpaper';

/** 外观模式；`system` 跟随操作系统的颜色偏好。 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** 壁纸默认保持原始清晰度，内容遮罩负责维持前景可读性。 */
export const DEFAULT_WALLPAPER_BLUR = 0;
export const DEFAULT_WALLPAPER_OPACITY = 0.6;

/** 启动器的持久化用户设置。 */
export interface LauncherSettings {
  themeMode: ThemeMode;
  seedColor: string;
  language: 'zh-CN' | 'en-US';
  defaultInstallDir: string;
  closeToTray: boolean;
  hardwareAcceleration: boolean;
  maxLogFileSizeMb: number;
  maxLogArchiveDays: number;
  compressLogArchive: boolean;
  /** 当前受管壁纸的类型；`none` 时其余壁纸字段不参与渲染。 */
  wallpaperType: WallpaperType;
  /** 存储于应用数据目录 wallpapers 下的受管文件名，绝不保存用户原始路径。 */
  wallpaperFileName: string;
  /** 媒体本身的模糊半径，单位 px。 */
  wallpaperBlur: number;
  /** 内容表面的不透明度，值越低露出的壁纸越多。 */
  wallpaperOpacity: number;
  /** 首次引导是否已完成；未完成时应用强制停在 OOBE 路由，直到 OOBE 服务将其置为 true。 */
  oobeCompleted: boolean;
}
