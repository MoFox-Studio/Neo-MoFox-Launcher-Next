import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'material-symbols/rounded.css';
import '@/styles/tokens.css';
import '@/styles/base.css';
import App from '@/App.vue';
import { router } from '@/router';
import { applyTheme, watchSystemScheme } from '@/services/theme';
import { useSettingsStore } from '@/stores/settings';

// 渲染进程入口：先恢复可用主题，再挂载应用并同步持久化设置。
async function bootstrap(): Promise<void> {
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);

  // 必须在 mount 前完成设置加载，否则路由守卫触发时 settings.loaded 仍为 false，
  // 即使持久化中 oobeCompleted=true，也会被强制重定向到 /oobe 并卡住无法自动跳走。
  const settingsStore = useSettingsStore();
  try {
    await settingsStore.load();
  } catch {
    /* 读取失败时保留默认设置与主题，路由守卫将按未完成 OOBE 处理 */
  }
  // load() 已应用主题，避免无主题闪烁；失败时补一次默认主题兜底。
  applyTheme(settingsStore.settings.seedColor, settingsStore.settings.themeMode);

  app.mount('#app');

  // 挂载后由设置仓库接管后续主题更新与系统主题监听。
  watchSystemScheme(() => ({
    seed: settingsStore.settings.seedColor,
    mode: settingsStore.settings.themeMode,
  }));
}

void bootstrap();
