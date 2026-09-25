import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  DEFAULT_WALLPAPER_BLUR,
  DEFAULT_WALLPAPER_DIM,
  DEFAULT_WALLPAPER_OPACITY,
  type LauncherSettings,
} from '@shared/domain/settings';
import { mofoxApi } from '@/services/mofox-api';
import { applyAppearancePreferences, applyTheme } from '@/services/theme';

export const DEFAULT_SEED = '#7C5CDB';

// 设置仓库负责持久化配置、加载状态及主题副作用。
export const useSettingsStore = defineStore('settings', () => {
  // 默认值保证 API 返回前界面仍有可渲染的设置模型。
  const settings = ref<LauncherSettings>({
    themeMode: 'system',
    themeColorSource: 'manual',
    seedColor: DEFAULT_SEED,
    wallpaperSeedColor: '',
    paletteStyle: 'tonal-spot',
    themeContrast: 'standard',
    appearanceDensity: 'comfortable',
    motionPreference: 'system',
    systemBackdrop: true,
    navigationPosition: 'side',
    navigationStyle: 'standard',
    language: 'zh-CN',
    defaultInstallDir: '',
    closeToTray: true,
    hardwareAcceleration: true,
    maxLogFileSizeMb: 16,
    maxLogArchiveDays: 14,
    compressLogArchive: true,
    wallpaperType: 'none',
    wallpaperFileName: '',
    wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
    wallpaperDim: DEFAULT_WALLPAPER_DIM,
    wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
    oobeCompleted: false,
  });
  const systemAccentColor = ref<string | null>(null);
  const loaded = ref(false);

  /** 根据用户选择解析主题色；动态来源不可用时稳定回退到手动种子色。 */
  const effectiveSeedColor = computed(() => {
    if (settings.value.themeColorSource === 'wallpaper' && settings.value.wallpaperSeedColor) {
      return settings.value.wallpaperSeedColor;
    }
    if (settings.value.themeColorSource === 'system' && systemAccentColor.value) {
      return systemAccentColor.value;
    }
    return settings.value.seedColor;
  });

  function applyCurrentAppearance(): void {
    applyTheme(
      effectiveSeedColor.value,
      settings.value.themeMode,
      settings.value.paletteStyle,
      settings.value.themeContrast,
    );
    applyAppearancePreferences(settings.value);
  }

  async function load(): Promise<void> {
    // 异步读取完整设置后，才标记为已加载并应用其主题。
    const [nextSettings, accentColor] = await Promise.all([
      mofoxApi.getSettings(),
      mofoxApi.getSystemAccentColor().catch(() => null),
    ]);
    settings.value = nextSettings;
    systemAccentColor.value = accentColor;
    loaded.value = true;
    applyCurrentAppearance();
  }

  async function update(patch: Partial<LauncherSettings>): Promise<void> {
    // 以后端返回的规范化结果为准；设置量很小，统一重放可避免遗漏新增外观字段。
    settings.value = await mofoxApi.updateSettings(patch);
    applyCurrentAppearance();
  }

  /**
   * 采用由非 settings:update IPC 返回的规范设置快照。
   *
   * 壁纸提交和删除会在主进程内同时更新文件与设置，因此不能重复提交相同补丁。
   *
   * @param next - 主进程返回的完整、已规范化设置。
   */
  function replace(next: LauncherSettings): void {
    settings.value = next;
    applyCurrentAppearance();
  }

  /** 接收操作系统实时强调色事件；仅系统颜色来源会因此改变实际主题。 */
  function setSystemAccentColor(color: string | null): void {
    systemAccentColor.value = color;
    if (settings.value.themeColorSource === 'system') applyCurrentAppearance();
  }

  return {
    settings,
    systemAccentColor,
    effectiveSeedColor,
    loaded,
    load,
    update,
    replace,
    applyCurrentAppearance,
    setSystemAccentColor,
  };
});
