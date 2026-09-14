import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettings, updateSettings, getSystemAccentColor } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getSystemAccentColor: vi.fn(),
}));
vi.mock('@/services/mofox-api', () => ({
  mofoxApi: { getSettings, updateSettings, getSystemAccentColor },
}));
vi.mock('@/services/theme', () => ({
  applyTheme: vi.fn(),
  applyAppearancePreferences: vi.fn(),
}));

import { useSettingsStore } from '../../../../src/renderer/src/stores/settings';

const settings = {
  themeMode: 'dark' as const,
  themeColorSource: 'manual' as const,
  seedColor: '#123456',
  wallpaperSeedColor: '',
  paletteStyle: 'tonal-spot' as const,
  themeContrast: 'standard' as const,
  appearanceDensity: 'comfortable' as const,
  motionPreference: 'system' as const,
  navigationPosition: 'side' as const,
  navigationStyle: 'standard' as const,
  language: 'zh-CN' as const,
  defaultInstallDir: 'D:\\Bots',
  closeToTray: false,
  hardwareAcceleration: true,
  maxLogFileSizeMb: 16,
  maxLogArchiveDays: 14,
  compressLogArchive: true,
  wallpaperType: 'none' as const,
  wallpaperFileName: '',
  wallpaperBlur: 0,
  wallpaperDim: 0.12,
  wallpaperOpacity: 0.6,
  oobeCompleted: true,
};

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getSettings.mockReset().mockResolvedValue(settings);
    updateSettings.mockReset().mockResolvedValue(settings);
    getSystemAccentColor.mockReset().mockResolvedValue('#0078D4');
  });

  // 验证首次加载会采用持久化配置并结束加载态。
  it('loads real API values and marks itself loaded', async () => {
    const store = useSettingsStore();

    await store.load();

    expect(store.settings).toEqual(settings);
    expect(store.loaded).toBe(true);
  });

  // 验证局部更新透传给 API，且仓库使用其规范化响应。
  it('sends partial updates and adopts the canonical response', async () => {
    const store = useSettingsStore();

    await store.update({ closeToTray: false });

    expect(updateSettings).toHaveBeenCalledWith({ closeToTray: false });
    expect(store.settings).toEqual(settings);
  });
});
