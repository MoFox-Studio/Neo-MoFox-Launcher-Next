/**
 * Material Design 3 动态主题服务。
 * 根据种子色生成完整色板并写入 CSS 变量，以便挂载前消除无主题闪烁。
 */
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  MaterialDynamicColors,
  SchemeTonalSpot,
} from '@material/material-color-utilities';
import type { ThemeMode } from '@shared/domain/instance';

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

function toKebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function buildScheme(seedHex: string, dark: boolean): Record<ColorKey, string> {
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seedHex)), dark, 0);
  const out = {} as Record<ColorKey, string>;
  for (const key of COLOR_KEYS) {
    const dynamicColor = MaterialDynamicColors[key];
    out[key] = hexFromArgb(dynamicColor.getArgb(scheme));
  }
  return out;
}

export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(seedHex: string, mode: ThemeMode): void {
  // 每次设置变化都重新计算并覆盖根元素的 MD3 色彩变量。
  const dark = resolveDark(mode);
  const scheme = buildScheme(seedHex, dark);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(scheme)) {
    root.style.setProperty(`--md-sys-color-${toKebab(key)}`, value);
  }
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/** 仅在跟随系统模式下响应操作系统主题切换。 */
export function watchSystemScheme(getState: () => { seed: string; mode: ThemeMode }): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    const { seed, mode } = getState();
    if (mode === 'system') applyTheme(seed, mode);
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
