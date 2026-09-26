<script setup lang="ts">
import { ref } from 'vue';
import { DEFAULT_HOME_SETTINGS, normalizeHomeSettings } from '@shared/domain/home';
import { useSettingsStore } from '@/stores/settings';
import { useHomeGeometryStore } from '@/stores/home-geometry';
import { normalizeGeometry } from '@/utils/home-layout';
import HomeLayoutEditor from './HomeLayoutEditor.vue';
const settings = useSettingsStore();
const geometry = useHomeGeometryStore();
const editorOpen = ref(false);
const busy = ref(false);
const error = ref('');
async function reset(): Promise<void> {
  busy.value = true;
  error.value = '';
  const previous = JSON.parse(JSON.stringify(geometry.geometry));
  try {
    geometry.save(
      normalizeGeometry(
        null,
        DEFAULT_HOME_SETTINGS.widgets.map((widget) => widget.id),
      ),
    );
    try {
      await settings.update({ home: normalizeHomeSettings(DEFAULT_HOME_SETTINGS) });
    } catch (cause) {
      geometry.save(previous);
      throw cause;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '恢复失败，请重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="settings-group">
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">dashboard_customize</span>
        <div>
          <h2>主页布局</h2>
          <p>自由组合小组件的顺序、尺寸和内容</p>
        </div>
      </div>
      <div class="home-settings-actions">
        <button type="button" class="layout-button" :disabled="busy" @click="editorOpen = true">
          <span class="msr">edit_dashboard</span>自定义主页
        </button>
        <button
          type="button"
          class="layout-button layout-button--secondary"
          :disabled="busy"
          @click="reset"
        >
          <span class="msr">restart_alt</span>{{ busy ? '恢复中…' : '恢复默认设置' }}
        </button>
        <p>恢复默认会重置小组件的开关、顺序、尺寸和内容设置，并清空文档列表。</p>
        <p v-if="error" role="alert">{{ error }}</p>
      </div>
    </section>
    <HomeLayoutEditor v-if="editorOpen" @close="editorOpen = false" />
  </div>
</template>
<style scoped src="./settings-panel.css"></style>
<style scoped>
.home-settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 24px 24px;
}
.layout-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 22px;
  border: 0;
  border-radius: 24px;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}
.layout-button--secondary {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.layout-button:disabled {
  opacity: 0.5;
}
p {
  width: 100%;
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}
p[role='alert'] {
  color: var(--md-sys-color-error);
}
</style>
