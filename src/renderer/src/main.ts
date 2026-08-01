import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'material-symbols/rounded.css';
import '@/styles/tokens.css';
import '@/styles/base.css';
import App from '@/App.vue';
import { router } from '@/router';
import { applyTheme, watchSystemScheme } from '@/services/theme';
import { mofoxApi } from '@/services/mofox-api';
import { DEFAULT_SEED, useSettingsStore } from '@/stores/settings';

// 渲染进程入口：先恢复可用主题，再挂载应用并同步持久化设置。
async function bootstrap(): Promise<void> {
  // 挂载前应用主题，避免界面出现无主题闪烁。
  let seed = DEFAULT_SEED;
  let mode: 'system' | 'light' | 'dark' = 'system';
  try {
    const settings = await mofoxApi.getSettings();
    seed = settings.seedColor;
    mode = settings.themeMode;
  } catch {
    /* 读取失败时保留默认主题 */
  }
  applyTheme(seed, mode);

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount('#app');

  // 挂载后由设置仓库接管后续主题更新与系统主题监听。
  const settingsStore = useSettingsStore();
  await settingsStore.load();
  watchSystemScheme(() => ({
    seed: settingsStore.settings.seedColor,
    mode: settingsStore.settings.themeMode,
  }));
}

void bootstrap();
