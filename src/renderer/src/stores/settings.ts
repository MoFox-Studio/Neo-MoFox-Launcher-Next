import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { LauncherSettings } from '@shared/domain/instance';
import { mofoxApi } from '@/services/mofox-api';
import { applyTheme } from '@/services/theme';

export const DEFAULT_SEED = '#7C5CDB';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<LauncherSettings>({
    themeMode: 'system',
    seedColor: DEFAULT_SEED,
    language: 'zh-CN',
    defaultInstallDir: '',
    mirrorAutoSelect: true,
    closeToTray: true,
    hardwareAcceleration: true,
    maxLogFileSizeMb: 16,
    maxLogArchiveDays: 14,
    compressLogArchive: true,
  });
  const loaded = ref(false);

  async function load(): Promise<void> {
    settings.value = await mofoxApi.getSettings();
    loaded.value = true;
    applyTheme(settings.value.seedColor, settings.value.themeMode);
  }

  async function update(patch: Partial<LauncherSettings>): Promise<void> {
    settings.value = await mofoxApi.updateSettings(patch);
    if (patch.seedColor !== undefined || patch.themeMode !== undefined) {
      applyTheme(settings.value.seedColor, settings.value.themeMode);
    }
  }

  return { settings, loaded, load, update };
});
