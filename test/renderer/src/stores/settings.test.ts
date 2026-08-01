import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettings, updateSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock('@/services/mofox-api', () => ({
  mofoxApi: { getSettings, updateSettings },
}));
vi.mock('@/services/theme', () => ({ applyTheme: vi.fn() }));

import { useSettingsStore } from '../../../../src/renderer/src/stores/settings';

const settings = {
  themeMode: 'dark' as const,
  seedColor: '#123456',
  language: 'zh-CN' as const,
  defaultInstallDir: 'D:\\Bots',
  closeToTray: false,
  hardwareAcceleration: true,
  maxLogFileSizeMb: 16,
  maxLogArchiveDays: 14,
  compressLogArchive: true,
};

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getSettings.mockReset().mockResolvedValue(settings);
    updateSettings.mockReset().mockResolvedValue(settings);
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
