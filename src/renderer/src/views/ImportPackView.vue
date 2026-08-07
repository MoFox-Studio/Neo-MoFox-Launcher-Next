<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useInstancesStore } from '@/stores/instances';
import { usePackStore } from '@/stores/pack';
import { mofoxApi } from '@/services/mofox-api';
import PageHeader from '@/components/PageHeader.vue';
import type { PackManifest, PackValidationResult } from '@shared/domain/pack';

// 导入整合包：选择 .mfpack 文件 → 校验 → 填写目标目录 → 导入并展示进度。
const router = useRouter();
const instancesStore = useInstancesStore();
const packStore = usePackStore();

const packPath = ref('');
const validation = ref<PackValidationResult | null>(null);
const validating = ref(false);
const instanceName = ref('');
const targetDir = ref('');
const importing = ref(false);
const finished = ref(false);
const errorMessage = ref<string | null>(null);

const manifest = computed<PackManifest | null>(() => validation.value?.manifest ?? null);

onMounted(() => {
  instancesStore.refresh();
});

async function choosePack(): Promise<void> {
  const picked = await mofoxApi.pickFile({
    title: '选择整合包',
    filters: [{ name: 'MoFox 整合包', extensions: ['mfpack'] }],
  });
  if (!picked) return;
  packPath.value = picked[0];
  validation.value = null;
  errorMessage.value = null;
  void validate();
}

async function validate(): Promise<void> {
  if (!packPath.value.trim()) return;
  validating.value = true;
  errorMessage.value = null;
  try {
    validation.value = await mofoxApi.validateIntegrationPack(packPath.value);
    if (validation.value.manifest && !instanceName.value) {
      instanceName.value = validation.value.manifest.packName;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    validating.value = false;
  }
}

async function chooseTargetDir(): Promise<void> {
  const picked = await mofoxApi.pickDirectory({
    title: '选择实例存放目录',
    defaultPath: targetDir.value || undefined,
  });
  if (!picked) return;
  targetDir.value = picked;
}

async function startImport(): Promise<void> {
  if (!packPath.value.trim() || !targetDir.value.trim()) return;
  importing.value = true;
  finished.value = false;
  errorMessage.value = null;
  packStore.reset();
  try {
    await mofoxApi.importIntegrationPack({
      packPath: packPath.value,
      instanceName: (instanceName.value.trim() || (manifest.value?.packName ?? '整合包实例')),
      targetDir: targetDir.value,
    });
    finished.value = true;
    await instancesStore.refresh();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    importing.value = false;
  }
}

function goInstances(): void {
  void router.push({ name: 'instances' });
}
</script>

<template>
  <div class="import-pack">
    <PageHeader title="导入整合包" subtitle="从 .mfpack 文件还原一个完整实例" />

    <div class="import-pack__body">
      <div class="card">
        <div class="form-row">
          <label class="form-label" for="pack-path">整合包文件</label>
          <div class="path-picker">
            <input
              id="pack-path"
              v-model="packPath"
              class="form-input"
              type="text"
              readonly
              placeholder="选择一个 .mfpack 文件"
            />
            <button class="btn btn--tonal state-layer" type="button" @click="choosePack">
              {{ packPath ? '重新选择' : '浏览…' }}
            </button>
          </div>
        </div>

        <div v-if="validating" class="import-pack__hint">正在校验整合包…</div>

        <template v-if="validation">
          <div v-if="validation.valid && manifest" class="manifest-card">
            <h3 class="manifest-card__title">{{ manifest.packName }}</h3>
            <dl class="manifest-card__meta">
              <div>
                <dt>版本</dt>
                <dd>{{ manifest.packVersion || '-' }}</dd>
              </div>
              <div>
                <dt>作者</dt>
                <dd>{{ manifest.author || '-' }}</dd>
              </div>
              <div>
                <dt>描述</dt>
                <dd>{{ manifest.description || '-' }}</dd>
              </div>
              <div>
                <dt>内容</dt>
                <dd>
                  <span v-if="manifest.content.neoMofox.included">主程序</span>
                  <span v-if="manifest.content.plugins.included">插件</span>
                  <span v-if="manifest.content.config.included">配置</span>
                  <span v-if="manifest.content.pluginConfigs?.included">插件配置</span>
                  <span v-if="manifest.content.data.included">数据</span>
                  <span v-if="!manifest.content.neoMofox.included && !manifest.content.plugins.included && !manifest.content.config.included && !manifest.content.pluginConfigs?.included && !manifest.content.data.included">无</span>
                </dd>
              </div>
            </dl>
          </div>

          <p v-if="!validation.valid" class="import-pack__error">
            {{ validation.errors.join('；') }}
          </p>
          <p v-if="validation.warnings.length" class="import-pack__warn">
            {{ validation.warnings.join('；') }}
          </p>

          <div class="form-row">
            <label class="form-label" for="import-name">实例名称</label>
            <input
              id="import-name"
              v-model="instanceName"
              class="form-input"
              type="text"
              placeholder="实例显示名称"
            />
          </div>

          <div class="form-row">
            <label class="form-label" for="target-dir">存放目录</label>
            <div class="path-picker">
              <input
                id="target-dir"
                v-model="targetDir"
                class="form-input"
                type="text"
                readonly
                placeholder="选择实例存放目录"
              />
              <button class="btn btn--tonal state-layer" type="button" @click="chooseTargetDir">
                浏览…
              </button>
            </div>
          </div>

          <p v-if="errorMessage" class="import-pack__error">{{ errorMessage }}</p>
          <p v-if="finished" class="import-pack__success">导入完成，实例已创建</p>

          <div v-if="importing" class="import-pack__progress">
            <div class="progress-bar">
              <span class="progress-bar__fill" :style="{ width: `${packStore.percent}%` }"></span>
            </div>
            <ul class="import-pack__logbox">
              <li v-for="(msg, idx) in packStore.messages" :key="idx">{{ msg }}</li>
            </ul>
          </div>

          <div class="import-pack__actions">
            <button class="btn btn--text state-layer" type="button" @click="goInstances">
              查看实例
            </button>
            <button
              class="btn btn--filled state-layer"
              type="button"
              :disabled="importing || !targetDir || !validation.valid"
              @click="startImport"
            >
              {{ importing ? '正在导入…' : finished ? '导入完成' : '开始导入' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.import-pack {
  height: 100%;
  overflow-y: auto;
}

.import-pack__body {
  padding: 0 32px 32px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  box-sizing: border-box;
}

.path-picker {
  display: flex;
  gap: 8px;
}

.path-picker .form-input {
  flex: 1;
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

.import-pack__hint {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.manifest-card {
  padding: 16px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-high);
}

.manifest-card__title {
  margin: 0 0 12px;
  font: var(--md-sys-typescale-title-medium);
  color: var(--md-sys-color-on-surface);
}

.manifest-card__meta {
  display: grid;
  gap: 8px;
  margin: 0;
}

.manifest-card__meta > div {
  display: flex;
  gap: 12px;
}

.manifest-card__meta dt {
  min-width: 64px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
}

.manifest-card__meta dd {
  margin: 0;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
}

.import-pack__error {
  margin: 0;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-medium);
}

.import-pack__warn {
  margin: 0;
  color: var(--md-sys-color-tertiary);
  font: var(--md-sys-typescale-body-medium);
}

.import-pack__success {
  margin: 0;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-body-medium);
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

.import-pack__logbox {
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

.import-pack__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>