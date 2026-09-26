import { defineStore } from 'pinia';
import { ref } from 'vue';
import { DEFAULT_HOME_SETTINGS } from '@shared/domain/home';
import { HOME_LAYOUT_KEY, normalizeGeometry, type HomeGeometry } from '@/utils/home-layout';
const ids = DEFAULT_HOME_SETTINGS.widgets.map((widget) => widget.id);
export const useHomeGeometryStore = defineStore('home-geometry', () => {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(HOME_LAYOUT_KEY) ?? 'null');
  } catch {
    /* Use defaults. */
  }
  const geometry = ref(normalizeGeometry(stored, ids));
  function save(value: HomeGeometry): void {
    const normalized = normalizeGeometry(value, ids);
    localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(normalized));
    geometry.value = normalized;
  }
  return { geometry, save };
});
