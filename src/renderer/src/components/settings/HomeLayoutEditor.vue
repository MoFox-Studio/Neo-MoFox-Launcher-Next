<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { HomeWidgetId, HomeWidgetState } from '@shared/domain/home';
import { useSettingsStore } from '@/stores/settings';
import { useHomeGeometryStore } from '@/stores/home-geometry';
import { HOME_WIDGET_DEFINITIONS } from '@/components/home/registry';
import HomeWidgetGrid from '@/components/home/HomeWidgetGrid.vue';
import HomeWidgetSettings from './HomeWidgetSettings.vue';
import type { HomeGeometry } from '@/utils/home-layout';

const emit = defineEmits<{ close: [] }>();
const settings = useSettingsStore();
const geometryStore = useHomeGeometryStore();
const widgets = ref<HomeWidgetState[]>(JSON.parse(JSON.stringify(settings.settings.home.widgets)));
const geometry = ref<HomeGeometry>(JSON.parse(JSON.stringify(geometryStore.geometry)));
const selected = ref<HomeWidgetId>(widgets.value[0]!.id);
const selectedWidget = computed(() =>
  widgets.value.find((widget) => widget.id === selected.value)!,
);
const selectedGeometry = computed(() => geometry.value[selected.value]!);
const dialog = ref<InstanceType<typeof window.HTMLDialogElement>>();
const busy = ref(false);
const error = ref('');
const previousFocus = document.activeElement as HTMLElement | null;
onMounted(async () => {
  await nextTick();
  dialog.value?.showModal();
});
onBeforeUnmount(() => {
  dialog.value?.close();
  previousFocus?.focus();
});
function meta(id: HomeWidgetId) {
  return HOME_WIDGET_DEFINITIONS.find((item) => item.id === id)!;
}
function updateWidget(
  id: HomeWidgetId,
  patch: { enabled?: boolean; config?: Record<string, unknown> },
): void {
  widgets.value = widgets.value.map((widget) =>
    widget.id === id ? ({ ...widget, ...patch } as HomeWidgetState) : widget,
  );
}
function reorder(ids: HomeWidgetId[]): void {
  const byId = new Map(widgets.value.map((widget) => [widget.id, widget]));
  let index = 0;
  widgets.value = widgets.value.map((widget) =>
    widget.enabled ? byId.get(ids[index++]!)! : widget,
  );
}
function close(): void {
  if (!busy.value) emit('close');
}
async function save(): Promise<void> {
  busy.value = true;
  error.value = '';
  const previousGeometry = JSON.parse(JSON.stringify(geometryStore.geometry)) as HomeGeometry;
  try {
    geometryStore.save(geometry.value);
    try {
      await settings.update({ home: { version: 1, widgets: widgets.value } });
    } catch (cause) {
      geometryStore.save(previousGeometry);
      throw cause;
    }
    emit('close');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败，请重试';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="layout-editor"
      aria-labelledby="layout-editor-title"
      @cancel.prevent="close"
    >
      <header class="layout-editor__header">
        <div>
          <h2 id="layout-editor-title">自定义主页</h2>
          <p>拖动组件标题调整顺序，点击组件编辑。保存后应用到主页。</p>
        </div>
        <button
          type="button"
          class="editor-button"
          :disabled="busy"
          aria-label="关闭布局编辑器"
          @click="close"
        >
          <span class="msr">close</span>
        </button>
      </header>
      <fieldset class="layout-editor__body" :disabled="busy">
        <aside class="layout-editor__library" aria-label="全部小组件">
          <h3>小组件</h3>
          <div
            v-for="widget in widgets"
            :key="widget.id"
            class="library-item"
            :class="{ 'library-item--selected': selected === widget.id }"
          >
            <button
              type="button"
              :aria-pressed="selected === widget.id"
              @click="selected = widget.id"
            >
              <span class="msr">{{ meta(widget.id).icon }}</span
              >{{ meta(widget.id).title }}
            </button>
            <input
              type="checkbox"
              :checked="widget.enabled"
              :aria-label="`显示${meta(widget.id).title}`"
              @change="updateWidget(widget.id, { enabled: !widget.enabled })"
            />
          </div>
          <p>关闭组件会保留它的尺寸和内容设置。</p>
        </aside>
        <main class="layout-editor__preview" aria-label="主页布局预览">
          <div class="preview-label">
            <span class="msr">dashboard</span>主页预览 <small>顶部状态卡片固定显示</small>
          </div>
          <HomeWidgetGrid
            :widgets="widgets"
            :geometry="geometry"
            editing
            :selected="selected"
            @select="selected = $event"
            @reorder="reorder"
          />
        </main>
        <aside class="layout-editor__settings" aria-label="选中组件设置">
          <h3>{{ meta(selected).title }}</h3>
          <p>{{ meta(selected).description }}</p>
          <label class="geometry-field"
            >宽度<select v-model="selectedGeometry.span">
              <option value="half">半宽</option>
              <option value="full">全宽</option>
            </select></label
          >
          <label class="geometry-field"
            >高度<select v-model="selectedGeometry.height">
              <option value="half">半高</option>
              <option value="full">全高</option>
              <option value="tall">加高 · 1.5 倍全高</option>
            </select></label
          >
          <template v-if="selectedGeometry.span === 'half'">
            <label class="geometry-field"
              >独占一行<input v-model="selectedGeometry.solo" type="checkbox"
            /></label>
            <label class="geometry-field"
              >作为行首时的位置<select v-model="selectedGeometry.side">
                <option value="left">左侧</option>
                <option value="right">右侧</option>
              </select></label
            >
            <p>允许并排时，后续半宽组件会堆叠到另一侧；总高度不能超过行首组件。</p>
          </template>
          <h4>内容设置</h4>
          <HomeWidgetSettings
            :key="selected"
            :widgets="widgets"
            :widget="selectedWidget"
            @update="updateWidget"
          />
        </aside>
      </fieldset>
      <footer class="layout-editor__footer">
        <span v-if="error" role="alert" class="editor-error">{{ error }}</span>
        <button type="button" class="editor-button" :disabled="busy" @click="close">取消</button>
        <button
          type="button"
          class="editor-button editor-button--primary"
          :disabled="busy"
          @click="save"
        >
          {{ busy ? '保存中…' : '保存布局' }}
        </button>
      </footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.layout-editor {
  width: min(1540px, calc(100vw - 40px));
  max-width: none;
  max-height: calc(100dvh - 40px);
  height: min(920px, calc(100dvh - 40px));
  padding: 0;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 24px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
}
.layout-editor[open] {
  display: flex;
  flex-direction: column;
}
.layout-editor::backdrop {
  background: #0008;
  backdrop-filter: blur(6px);
}
.layout-editor__header,
.layout-editor__footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 24px;
  flex: none;
}
.layout-editor__header {
  justify-content: space-between;
}
h2,
h3,
h4 {
  margin: 0 0 8px;
}
h2 {
  font: var(--md-sys-typescale-headline-small);
}
h3 {
  font: var(--md-sys-typescale-title-medium);
}
p {
  margin: 0 0 16px;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.6;
}
.layout-editor__header p {
  margin: 0;
}
.layout-editor__body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr) 290px;
  padding: 0;
  margin: 0;
  border: 0;
}
.layout-editor__library,
.layout-editor__settings,
.layout-editor__preview {
  overflow: auto;
  min-width: 0;
  padding: 20px 14px;
}
.layout-editor__preview {
  background: var(--md-sys-color-surface);
}
.layout-editor__preview :deep(.home-grid-container) {
  min-width: 640px;
  zoom: 0.75;
}
.preview-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
}
.preview-label small {
  margin-left: auto;
}
.library-item {
  display: flex;
  align-items: center;
  border-radius: 12px;
  padding: 4px 8px;
  margin-bottom: 6px;
}
.library-item--selected {
  background: var(--md-sys-color-secondary-container);
}
.library-item button {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  flex: 1;
  min-height: 40px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.geometry-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 14px 0;
}
select {
  max-width: 170px;
  padding: 8px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  background: var(--md-sys-color-surface);
  color: inherit;
}
input {
  accent-color: var(--md-sys-color-primary);
}
.layout-editor__footer {
  justify-content: flex-end;
}
.editor-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 24px;
  padding: 10px 18px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  cursor: pointer;
}
.editor-button--primary {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
.editor-button:disabled {
  opacity: 0.5;
}
.editor-error {
  color: var(--md-sys-color-error);
  margin-right: auto;
}
.layout-editor__settings :deep(.home-config) {
  margin: 0;
  padding: 0;
  background: transparent;
}
.layout-editor__settings :deep(.home-config__row) {
  padding: 8px 0;
}
.layout-editor__settings :deep(.docs-url-field) {
  min-width: 0;
  flex-basis: 100%;
}
@media (max-width: 1100px) {
  .layout-editor__body {
    grid-template-columns: 150px minmax(0, 1fr) 240px;
  }
  .layout-editor__library,
  .layout-editor__settings,
  .layout-editor__preview {
    padding: 14px 10px;
  }
  .preview-label small {
    display: none;
  }
}
@media (max-width: 800px) {
  .layout-editor__body {
    grid-template-columns: minmax(0, 1fr);
    overflow: auto;
    display: block;
  }
  .layout-editor__library,
  .layout-editor__settings,
  .layout-editor__preview {
    overflow: visible;
  }
  .layout-editor__library {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .layout-editor__library h3,
  .layout-editor__library p {
    width: 100%;
  }
}
</style>
