import type { WallpaperType } from './wallpaper';

/** 外观模式；`system` 跟随操作系统的颜色偏好。 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** 主题种子色来源；不可用时由渲染层安全回退到手动种子色。 */
export type ThemeColorSource = 'manual' | 'wallpaper' | 'system';

/** Material Color Utilities 0.3 提供的九种动态配色方案。 */
export type PaletteStyle =
  | 'tonal-spot'
  | 'neutral'
  | 'vibrant'
  | 'expressive'
  | 'rainbow'
  | 'fruit-salad'
  | 'monochrome'
  | 'fidelity'
  | 'content';

/** 动态色对比度级别，映射到 Material Color Utilities 的 0 / 0.5 / 1。 */
export type ThemeContrast = 'standard' | 'medium' | 'high';

/** 全局界面密度。 */
export type AppearanceDensity = 'compact' | 'comfortable' | 'spacious';

/** 全局动效偏好；`system` 服从操作系统的减弱动态效果设置。 */
export type MotionPreference = 'system' | 'expressive' | 'reduced' | 'none';

/** 主导航在应用框架中的停靠位置。 */
export type NavigationPosition = 'side' | 'bottom';

/** 主导航的表面样式。 */
export type NavigationStyle = 'standard' | 'floating';

/** 壁纸默认保持原始清晰度，独立的压暗层与内容表面负责维持前景可读性。 */
export const DEFAULT_WALLPAPER_BLUR = 0;
export const DEFAULT_WALLPAPER_OPACITY = 0.6;
export const DEFAULT_WALLPAPER_DIM = 0.12;

/** 启动器的持久化用户设置。 */
export interface LauncherSettings {
  themeMode: ThemeMode;
  /** 决定实际使用手动色、壁纸取色还是系统强调色。 */
  themeColorSource: ThemeColorSource;
  /** 手动主题色；也是其他来源暂不可用时的回退色。 */
  seedColor: string;
  /** 当前壁纸选中的取色结果；空字符串表示尚无可用壁纸色。 */
  wallpaperSeedColor: string;
  paletteStyle: PaletteStyle;
  themeContrast: ThemeContrast;
  appearanceDensity: AppearanceDensity;
  motionPreference: MotionPreference;
  /** 无壁纸时启用系统模糊材质(Win11 Mica / macOS vibrancy / 渲染端 CSS Mica 兜底)；关闭后使用纯色表面。 */
  systemBackdrop: boolean;
  navigationPosition: NavigationPosition;
  navigationStyle: NavigationStyle;
  language: 'zh-CN' | 'en-US';
  defaultInstallDir: string;
  /** 关闭窗口时是否隐藏到系统托盘继续运行；关闭后点击关闭按钮将直接退出。 */
  closeToTray: boolean;
  /** 启动器不在前台（失焦、最小化或托盘）时，安装/更新/依赖等任务完成是否弹出系统通知。 */
  trayNotifications: boolean;
  /** 启动器启动时是否自动检查每夜构建的新版本；发现更新后仅在界面弹出提示，不自动下载。 */
  autoCheckUpdates: boolean;
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
  /** 壁纸上的独立黑色压暗层透明度。 */
  wallpaperDim: number;
  /** 内容表面的不透明度，值越低露出的壁纸越多。 */
  wallpaperOpacity: number;
  /** 首次引导是否已完成；未完成时应用强制停在 OOBE 路由，直到 OOBE 服务将其置为 true。 */
  oobeCompleted: boolean;
}
