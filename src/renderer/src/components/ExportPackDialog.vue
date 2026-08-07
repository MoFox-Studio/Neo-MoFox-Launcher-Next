<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { Instance } from '@shared/domain/instance';
import type { PackItemInfo } from '@shared/domain/pack';
import BaseDialog from './BaseDialog.vue';
import { mofoxApi } from '@/services/mofox-api';
import { usePackStore } from '@/stores/pack';

// 整合包导出对话框：选择元数据与内容段，将实例打包为 .mfpack。
interface Props {
  instance: Instance;
  open: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const packStore = usePackStore();

const packName = ref('');
const packVersion = ref('1.0.0');
const packAuthor = ref('');
const packDescription = ref('');
const includeMofox = ref(true);
const includeConfig = ref(true);
const includePlugins = ref(true);
const includePluginConfigs = ref(true);
const includeData = ref(false);

const plugins = ref<PackItemInfo[]>([]);
const pluginConfigs = ref<PackItemInfo[]>([]);
const selectedPlugins = ref<string[]>([]);
const selectedPluginConfigs = ref<string[]>([]);

const exportDir = ref('');
const exporting = ref(false);
const finished = ref(false);
const resultPath = ref('');
const errorMessage = ref<string | null>(null);

watch(
  () => props.open,
  (open) => {
    if (open) {
      packName.value = `pack-${props.instance.name}`;
      packVersion.value = '1.0.0';
      packAuthor.value = '';
      packDescription.value = '';
      exporting.value = false;
      finished.value = false;
      errorMessage.value = null;
    }
  },
);

onMounted(() => {
  void loadItems();
});

async function loadItems(): Promise<void> {
  const [pluginList, configList] = await Promise.all([
    mofoxApi.scanInstancePlugins(props.instance.id),
    mofoxApi.scanInstancePluginConfigs(props.instance.id),
  ]);
  plugins.value = pluginList;
  pluginConfigs.value = configList;
  selectedPlugins.value = pluginList.map((p) => p.name);
  selectedPluginConfigs.value = configList.map((p) => p.name);
}

function toggleSelection(list: string[], name: string): void {
  const index = list.indexOf(name);
  if (index >= 0) void list.splice(index, 1);
  else list.push(name);
}

async function pickExportDir(): Promise<void> {
  const picked = await mofoxApi.pickDirectory({
    title: '选择导出目录',
    defaultPath: exportDir.value || undefined,
  });
  if (!picked) return;
  exportDir.value = picked;
}

async function startExport(): Promise<void> {
  if (!exportDir.value) {
    errorMessage.value = '请先选择导出目录';
    return;
  }
  exporting.value = true;
  finished.value = false;
  errorMessage.value = null;
  packStore.reset();
  try {
    const safeName = (packName.value || 'pack').replace(/[\\/:*?"<>|]/g, '_');
    const destPath = `${exportDir.value}\\${safeName}_${packVersion.value || '1.0.0'}.mfpack`;
    const exportOptions = {
      packName: String(packName.value),
      packVersion: String(packVersion.value),
      packAuthor: String(packAuthor.value),
      packDescription: String(packDescription.value),
      includeMofox: Boolean(includeMofox.value),
      includeConfig: Boolean(includeConfig.value),
      includePlugins: Boolean(includePlugins.value),
      selectedPlugins: [...selectedPlugins.value].map(String),
      includePluginConfigs: Boolean(includePluginConfigs.value),
      selectedPluginConfigs: [...selectedPluginConfigs.value].map(String),
      includeData: Boolean(includeData.value),
    };
    await mofoxApi.exportIntegrationPack(
      String(props.instance.id),
      JSON.parse(JSON.stringify(exportOptions)) as typeof exportOptions,
      String(destPath),
    );
    finished.value = true;
    resultPath.value = destPath;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <BaseDialog
    :open="open"
    title="导出整合包"
    width="600"
    :dismissible="!exporting"
    :show-actions="false"
    @close="emit('close')"
  >
    <div class="export-pack">
      <div class="form-row">
        <label class="form-label" for="export-name">整合包名称</label>
        <input id="export-name" v-model="packName" class="form-input" type="text" />
      </div>

      <div class="form-row form-row--row">
        <div>
          <label class="form-label" for="export-version">版本</label>
          <input id="export-version" v-model="packVersion" class="form-input" type="text" />
        </div>
        <div>
          <label class="form-label" for="export-author">作者</label>
          <input id="export-author" v-model="packAuthor" class="form-input" type="text" />
        </div>
      </div>

      <div class="form-row">
        <label class="form-label" for="export-desc">描述</label>
        <input id="export-desc" v-model="packDescription" class="form-input" type="text" />
      </div>

      <div class="export-options">
        <label class="checkbox-row">
          <md-checkbox :checked="includeMofox" @change="includeMofox = !includeMofox" />
          <span>包含主程序文件</span>
        </label>
        <label class="checkbox-row">
          <md-checkbox :checked="includeConfig" @change="includeConfig = !includeConfig" />
          <span>包含配置（自动脱敏）</span>
        </label>
        <label class="checkbox-row">
          <md-checkbox :checked="includePlugins" @change="includePlugins = !includePlugins" />
          <span>包含插件</span>
        </label>
        <label class="checkbox-row">
          <md-checkbox
            :checked="includePluginConfigs"
            @change="includePluginConfigs = !includePluginConfigs"
          />
          <span>包含插件配置</span>
        </label>
        <label class="checkbox-row">
          <md-checkbox :checked="includeData" @change="includeData = !includeData" />
          <span>包含数据文件</span>
        </label>
      </div>

      <template v-if="includePlugins">
        <p class="export-section-title">选择插件（{{ selectedPlugins.length }}/{{ plugins.length }}）</p>
        <div v-if="plugins.length === 0" class="export-empty">未发现插件</div>
        <div v-else class="item-list">
          <label v-for="p in plugins" :key="p.name" class="item-check">
            <md-checkbox
              :checked="selectedPlugins.includes(p.name)"
              @change="toggleSelection(selectedPlugins, p.name)"
            />
            <span>{{ p.name }}</span>
          </label>
        </div>
      </template>

      <template v-if="includePluginConfigs">
        <p class="export-section-title">选择插件配置（{{ selectedPluginConfigs.length }}/{{ pluginConfigs.length }}）</p>
        <div v-if="pluginConfigs.length === 0" class="export-empty">未发现插件配置</div>
        <div v-else class="item-list">
          <label v-for="p in pluginConfigs" :key="p.name" class="item-check">
            <md-checkbox
              :checked="selectedPluginConfigs.includes(p.name)"
              @change="toggleSelection(selectedPluginConfigs, p.name)"
            />
            <span>{{ p.name }}</span>
          </label>
        </div>
      </template>

      <div class="form-row">
        <label class="form-label" for="export-dir">导出目录</label>
        <div class="path-picker">
          <input
            id="export-dir"
            v-model="exportDir"
            class="form-input"
            type="text"
            readonly
            placeholder="选择导出目录"
          />
          <button class="btn btn--tonal state-layer" type="button" @click="pickExportDir">
            浏览…
          </button>
        </div>
      </div>

      <p v-if="errorMessage" class="export-pack__error">{{ errorMessage }}</p>
      <p v-if="finished" class="export-pack__success">导出完成：{{ resultPath }}</p>

      <div v-if="exporting" class="export-pack__progress">
        <div class="progress-bar">
          <span class="progress-bar__fill" :style="{ width: `${packStore.percent}%` }"></span>
        </div>
        <ul class="export-pack__logbox">
          <li v-for="(msg, idx) in packStore.messages" :key="idx">{{ msg }}</li>
        </ul>
      </div>

      <div class="export-pack__actions">
        <button
          class="btn btn--text state-layer"
          type="button"
          :disabled="exporting"
          @click="emit('close')"
        >
          关闭
        </button>
        <button
          class="btn btn--filled state-layer"
          type="button"
          :disabled="exporting || !exportDir"
          @click="startExport"
        >
          {{ exporting ? '正在导出…' : '开始导出' }}
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
.export-pack {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 8px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row--row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-row--row > div {
  min-width: 0;
}

.form-label {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
}

.form-input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-medium);
  background: color-mix(in srgb, var(--md-sys-color-surface-container-low) 54%, transparent);
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  transition:
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.form-input:hover {
  border-color: var(--md-sys-color-outline);
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 68%, transparent);
}

.form-input:focus {
  border-color: var(--md-sys-color-primary);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--md-sys-color-primary) 16%, transparent);
}

.path-picker {
  display: flex;
  gap: 8px;
}

.path-picker .form-input {
  flex: 1;
}

.export-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
  padding: 12px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-large);
  background: color-mix(in srgb, var(--app-glass-card) 58%, transparent);
}

.checkbox-row,
.item-check {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 32px;
  padding: 4px 6px;
  border-radius: var(--md-sys-shape-corner-small);
  cursor: pointer;
  font: var(--md-sys-typescale-body-medium);
}

.checkbox-row:hover,
.item-check:hover {
  background: color-mix(in srgb, var(--md-sys-color-primary) 7%, transparent);
}

.checkbox-row md-checkbox,
.item-check md-checkbox {
  --md-checkbox-container-size: 18px;
  --md-checkbox-selected-container-color: var(--md-sys-color-primary);
  --md-checkbox-selected-icon-color: var(--md-sys-color-on-primary);
  --md-checkbox-unselected-outline-color: var(--md-sys-color-outline);
  flex: none;
}

.item-check span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-section-title {
  margin: 2px 0 -8px;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-label-large);
}

.export-empty {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.item-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 8px;
  padding: 8px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-large);
  background: color-mix(in srgb, var(--md-sys-color-surface-container-low) 42%, transparent);
}

.btn {
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--tonal {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
  padding: 0 12px;
}

.export-pack__error {
  margin: 0;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-medium);
}

.export-pack__success {
  margin: 0;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-body-medium);
  word-break: break-all;
}

.progress-bar {
  height: 6px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-high);
  overflow: hidden;
}

.progress-bar__fill {
  display: block;
  height: 100%;
  background: var(--md-sys-color-primary);
  transition: width 0.2s ease;
}

.export-pack__logbox {
  height: 120px;
  overflow-y: auto;
  margin: 0;
  padding: 12px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: #101416;
  color: #cdd6e4;
  list-style: none;
  font: 12px/1.6 ui-monospace, "Cascadia Code", monospace;
}

.export-pack__actions {
  position: sticky;
  bottom: -1px;
  z-index: 1;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin: 0 -8px -8px;
  padding: 16px 8px 8px;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

@media (max-width: 560px) {
  .form-row--row,
  .export-options,
  .item-list {
    grid-template-columns: 1fr;
  }

  .path-picker {
    align-items: stretch;
  }

  .path-picker .btn {
    padding-inline: 16px;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .form-input,
  .export-options,
  .item-list {
    background: var(--md-sys-color-surface-container);
  }

  .export-pack__actions {
    background: var(--md-sys-color-surface-container-high);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>