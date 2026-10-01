<script setup lang="ts">
// 主页面板：入口行打开布局编辑器，恢复行还原默认主页设置；失败统一走全局轻提示。
import { ref } from 'vue';
import { DEFAULT_HOME_SETTINGS, normalizeHomeSettings } from '@shared/domain/home';
import { useSettingsStore } from '@/stores/settings';
import { useHomeGeometryStore } from '@/stores/home-geometry';
import { useToast } from '@/composables/use-toast';
import { normalizeGeometry } from '@/utils/home-layout';
import HomeLayoutEditor from './HomeLayoutEditor.vue';
const settings = useSettingsStore();
const geometry = useHomeGeometryStore();
const { show: showToast } = useToast();
const editorOpen = ref(false);
const busy = ref(false);
async function reset(): Promise<void> {
  busy.value = true;
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
    showToast(`恢复失败: ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="settings-group">
    <!-- 主页布局 -->
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">dashboard_customize</span>
        <div>
          <h2>主页布局</h2>
          <p>自由组合小组件的顺序、尺寸和内容</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">widgets</span>
          <div class="settings-item__body">
            <span class="settings-item__label">自定义主页</span>
            <span class="settings-item__desc">
              在编辑器中拖拽调整小组件的顺序与尺寸，配置小组件内容
            </span>
          </div>
          <button type="button" class="text-button state-layer" @click="editorOpen = true">
            打开编辑器
          </button>
        </div>
        <div class="settings-item">
          <span class="msr settings-item__icon">restart_alt</span>
          <div class="settings-item__body">
            <span class="settings-item__label">恢复默认设置</span>
            <span class="settings-item__desc">
              重置小组件的开关、顺序、尺寸和内容设置，并清空文档列表
            </span>
          </div>
          <button type="button" class="text-button state-layer" :disabled="busy" @click="reset">
            {{ busy ? '恢复中…' : '恢复' }}
          </button>
        </div>
      </div>
    </section>
    <HomeLayoutEditor v-if="editorOpen" @close="editorOpen = false" />
  </div>
</template>
<style scoped src="./settings-panel.css"></style>
