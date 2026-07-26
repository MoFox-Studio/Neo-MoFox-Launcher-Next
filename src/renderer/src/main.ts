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

async function bootstrap(): Promise<void> {
  // Theme must be applied before mount to avoid a flash of unthemed UI.
  let seed = DEFAULT_SEED;
  let mode: 'system' | 'light' | 'dark' = 'system';
  try {
    const settings = await mofoxApi.getSettings();
    seed = settings.seedColor;
    mode = settings.themeMode;
  } catch {
    /* fall back to defaults */
  }
  applyTheme(seed, mode);

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount('#app');

  const settingsStore = useSettingsStore();
  await settingsStore.load();
  watchSystemScheme(() => ({
    seed: settingsStore.settings.seedColor,
    mode: settingsStore.settings.themeMode,
  }));
}

void bootstrap();
