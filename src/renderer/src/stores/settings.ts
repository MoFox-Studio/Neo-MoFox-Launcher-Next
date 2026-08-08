import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  DEFAULT_WALLPAPER_BLUR,
  DEFAULT_WALLPAPER_OPACITY,
  type LauncherSettings,
} from '@shared/domain/settings';
import { mofoxApi } from '@/services/mofox-api';
import { applyTheme } from '@/services/theme';

export const DEFAULT_SEED = '#7C5CDB';

// 设置仓库负责持久化配置、加载状态及主题副作用。
export const useSettingsStore = defineStore('settings', () => {
  // 默认值保证 API 返回前界面仍有可渲染的设置模型。
  const settings = ref<LauncherSettings>({
    themeMode: 'system',
    seedColor: DEFAULT_SEED,
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
    wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
    oobeCompleted: false,
  });
  const loaded = ref(false);

  async function load(): Promise<void> {
    // 异步读取完整设置后，才标记为已加载并应用其主题。
    settings.value = await mofoxApi.getSettings();
    loaded.value = true;
    applyTheme(settings.value.seedColor, settings.value.themeMode);
  }

  async function update(patch: Partial<LauncherSettings>): Promise<void> {
    // 以后端返回的规范化结果为准，主题字段变化立即反映到根节点。
    settings.value = await mofoxApi.updateSettings(patch);
    if (patch.seedColor !== undefined || patch.themeMode !== undefined) {
      applyTheme(settings.value.seedColor, settings.value.themeMode);
    }
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
  }

  return { settings, loaded, load, update, replace };
});
