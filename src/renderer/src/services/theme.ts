/**
 * Material Design 3 动态主题服务。
 * 根据种子色生成完整色板并写入 CSS 变量，以便挂载前消除无主题闪烁。
 */
import {
  argbFromHex,
  DynamicScheme,
  hexFromArgb,
  Hct,
  MaterialDynamicColors,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeFruitSalad,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
} from '@material/material-color-utilities';
import type {
  LauncherSettings,
  MotionPreference,
  PaletteStyle,
  ThemeContrast,
  ThemeMode,
} from '@shared/domain/settings';

// 动态色工具支持且需要暴露给组件样式的系统色键。
const COLOR_KEYS = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'background',
  'onBackground',
  'surface',
  'onSurface',
  'surfaceVariant',
  'onSurfaceVariant',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'outline',
  'outlineVariant',
  'shadow',
  'scrim',
  'inverseSurface',
  'inverseOnSurface',
  'inversePrimary',
  'surfaceTint',
] as const;

type ColorKey = (typeof COLOR_KEYS)[number];
export type ThemeScheme = Readonly<Record<ColorKey, string>>;

type SchemeConstructor = new (
  sourceColorHct: Hct,
  isDark: boolean,
  contrastLevel: number,
) => DynamicScheme;

const SCHEME_CONSTRUCTORS: Record<PaletteStyle, SchemeConstructor> = {
  'tonal-spot': SchemeTonalSpot,
  neutral: SchemeNeutral,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  rainbow: SchemeRainbow,
  'fruit-salad': SchemeFruitSalad,
  monochrome: SchemeMonochrome,
  fidelity: SchemeFidelity,
  content: SchemeContent,
};

const CONTRAST_LEVELS: Record<ThemeContrast, number> = {
  standard: 0,
  medium: 0.5,
  high: 1,
};

const schemeCache = new Map<string, ThemeScheme>();
const MAX_SCHEME_CACHE_SIZE = 192;

function toKebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** 生成完整 MD3 动态色角色，并缓存同一输入的计算结果供主题预览复用。 */
export function buildThemeScheme(
  seedHex: string,
  dark: boolean,
  paletteStyle: PaletteStyle = 'tonal-spot',
  contrast: ThemeContrast = 'standard',
): ThemeScheme {
  const normalizedSeed = seedHex.toUpperCase();
  const cacheKey = `${normalizedSeed}:${dark ? 'dark' : 'light'}:${paletteStyle}:${contrast}`;
  const cached = schemeCache.get(cacheKey);
  if (cached) return cached;

  const Scheme = SCHEME_CONSTRUCTORS[paletteStyle];
  const scheme = new Scheme(
    Hct.fromInt(argbFromHex(normalizedSeed)),
    dark,
    CONTRAST_LEVELS[contrast],
  );
  const out = {} as Record<ColorKey, string>;
  for (const key of COLOR_KEYS) {
    const dynamicColor = MaterialDynamicColors[key];
    out[key] = hexFromArgb(dynamicColor.getArgb(scheme));
  }
  schemeCache.set(cacheKey, out);
  if (schemeCache.size > MAX_SCHEME_CACHE_SIZE) {
    const oldestKey = schemeCache.keys().next().value;
    if (oldestKey) schemeCache.delete(oldestKey);
  }
  return out;
}

export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(
  seedHex: string,
  mode: ThemeMode,
  paletteStyle: PaletteStyle = 'tonal-spot',
  contrast: ThemeContrast = 'standard',
): void {
  // 每次设置变化都重新计算并覆盖根元素的 MD3 色彩变量。
  const dark = resolveDark(mode);
  const scheme = buildThemeScheme(seedHex, dark, paletteStyle, contrast);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(scheme)) {
    root.style.setProperty(`--md-sys-color-${toKebab(key)}`, value);
  }
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/** 把非色彩个性化偏好写到根节点，让全部组件共享同一组布局与动效令牌。 */
export function applyAppearancePreferences(
  settings: Pick<LauncherSettings, 'appearanceDensity' | 'motionPreference'>,
): void {
  const root = document.documentElement;
  root.dataset.density = settings.appearanceDensity;
  root.dataset.motion = settings.motionPreference;
}

/** 仅在跟随系统模式下响应操作系统主题切换。 */
export function watchSystemScheme(
  getState: () => {
    seed: string;
    mode: ThemeMode;
    paletteStyle: PaletteStyle;
    contrast: ThemeContrast;
  },
): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    const { seed, mode, paletteStyle, contrast } = getState();
    if (mode === 'system') applyTheme(seed, mode, paletteStyle, contrast);
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

/** 判断当前设置是否应停用重动效，供视频壁纸等无法只靠 CSS 控制的内容使用。 */
export function shouldReduceMotion(
  preference: MotionPreference,
  systemPrefersReducedMotion: boolean,
): boolean {
  return (
    preference === 'none' ||
    preference === 'reduced' ||
    (preference === 'system' && systemPrefersReducedMotion)
  );
}
