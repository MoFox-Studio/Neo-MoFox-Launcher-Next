import { computed } from 'vue';
import { DEFAULT_HOME_SETTINGS } from '@shared/domain/home';
import { useSettingsStore } from '@/stores/settings';

/** The editor commits a complete draft; dashboard reads the saved widget order. */
export function useHomeWidgets() {
  const settingsStore = useSettingsStore();
  const home = computed(() => settingsStore.settings.home ?? DEFAULT_HOME_SETTINGS);
  const widgets = computed(() => home.value.widgets);
  return { home, widgets };
}
