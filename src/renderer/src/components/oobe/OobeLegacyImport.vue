<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { mofoxApi } from '@/services/mofox-api';
import { MofoxError } from '@shared/domain/error';
import type { LegacyLauncherInfo, MigrationPreview, MigrationResult } from '@shared/domain/migration';

const emit = defineEmits<{ (e: 'next'): void; (e: 'skip'): void }>();

const legacyInfo = ref<LegacyLauncherInfo | null>(null);
const preview = ref<MigrationPreview | null>(null);
const result = ref<MigrationResult | null>(null);
const phase = ref<'detected' | 'previewed' | 'done' | 'missing'>('detected');
const busy = ref(false);
const errorMessage = ref<string | null>(null);

function describeError(error: unknown): string {
  if (error instanceof MofoxError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}

async function previewMigration(): Promise<void> {
  busy.value = true;
  errorMessage.value = null;
  try {
    preview.value = await mofoxApi.previewLegacyMigration();
    phase.value = 'previewed';
  } catch (error) {
    errorMessage.value = describeError(error);
  } finally {
    busy.value = false;
  }
}

async function importMigration(): Promise<void> {
  busy.value = true;
  errorMessage.value = null;
  try {
    result.value = await mofoxApi.importLegacyMigration();
    phase.value = 'done';
  } catch (error) {
    errorMessage.value = describeError(error);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  busy.value = true;
  try {
    legacyInfo.value = await mofoxApi.detectLegacyLauncher();
    if (!legacyInfo.value) {
      // 没有检测到旧版，自动跳过本步骤。
      emit('skip');
      return;
    }
    phase.value = 'detected';
  } catch (error) {
    errorMessage.value = describeError(error);
    phase.value = 'missing';
  } finally {
    busy.value = false;
  }
});
</script>

<template>
  <section class="oobe-step">
    <h2 class="oobe__step-title">导入旧版实例</h2>
    <p class="oobe__step-desc">如检测到旧版 Neo-MoFox Launcher 数据目录，可以选择导入其中的实例记录</p>

    <div v-if="legacyInfo" class="legacy-info">
      <span class="msr legacy-info__icon" aria-hidden="true">folder</span>
      <div class="legacy-info__body">
        <span class="legacy-info__path">{{ legacyInfo.dataDirectory }}</span>
        <span class="legacy-info__meta">共 {{ legacyInfo.instanceCount }} 个实例 · 最后修改于
          {{ new Date(legacyInfo.modifiedAt ?? Date.now()).toLocaleString('zh-CN') }}</span>
      </div>
    </div>

    <div v-if="errorMessage" class="legacy-error">
      <span class="msr legacy-error__icon" aria-hidden="true">error</span>
      <span>{{ errorMessage }}</span>
    </div>

    <template v-if="preview">
      <p class="legacy-hint">
        共 {{ preview.previews.length }} 条记录，其中
        <span class="legacy-hint--conflict">{{ preview.previews.filter((p) => p.conflict).length }} 条冲突将被跳过</span>
      </p>
      <ul class="legacy-list">
        <li
          v-for="entry in preview.previews"
          :key="entry.instance.id"
          class="legacy-list__item"
          :class="{ 'legacy-list__item--conflict': entry.conflict }"
        >
          <span class="msr legacy-list__icon" aria-hidden="true">{{ entry.conflict ? 'block' : 'check_circle' }}</span>
          <span class="legacy-list__name">{{ entry.instance.name }}</span>
          <span class="legacy-list__meta">{{ Object.keys(entry.instance.platforms ?? {})[0] ?? '' }} · {{ entry.instance.mofoxInstallDir }}</span>
        </li>
      </ul>
    </template>

    <div v-if="result" class="legacy-result">
      <span class="msr legacy-result__icon" aria-hidden="true">check_circle</span>
      <span>导入 {{ result.imported }} 个，跳过 {{ result.skipped }} 个，共 {{ result.total }} 个实例</span>
    </div>

    <div class="legacy-actions">
      <button type="button" class="btn btn--text state-layer" :disabled="busy" @click="emit('skip')">
        跳过导入
      </button>
      <button
        v-if="phase === 'detected'"
        type="button"
        class="btn btn--filled state-layer"
        :disabled="busy"
        @click="previewMigration"
      >
        <span v-if="busy" class="spinner spinner--small" aria-hidden="true"></span>
        预览导入
      </button>
      <button
        v-else-if="phase === 'previewed'"
        type="button"
        class="btn btn--filled state-layer"
        :disabled="busy"
        @click="importMigration"
      >
        确认导入
      </button>
      <button
        v-else
        type="button"
        class="btn btn--filled state-layer"
        :disabled="busy"
        @click="emit('next')"
      >
        继续
      </button>
    </div>
  </section>
</template>

<style scoped>
.legacy-info {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-high);
  margin-bottom: 16px;
}

.legacy-info__icon {
  color: var(--md-sys-color-primary);
  font-size: 24px;
}

.legacy-info__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.legacy-info__path {
  font: var(--md-sys-typescale-body-medium);
  font-family: var(--md-ref-typeface-mono);
  word-break: break-all;
}

.legacy-info__meta {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.legacy-error,
.legacy-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font: var(--md-sys-typescale-body-medium);
  margin-bottom: 16px;
}

.legacy-error {
  color: var(--md-sys-color-error);
}

.legacy-result {
  color: var(--md-sys-color-tertiary);
}

.legacy-error__icon,
.legacy-result__icon {
  font-size: 20px;
}

.legacy-hint {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 8px;
}

.legacy-hint--conflict {
  color: var(--md-sys-color-error);
}

.legacy-list {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}

.legacy-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.legacy-list__item--conflict {
  opacity: 0.65;
}

.legacy-list__icon {
  font-size: 18px;
  color: var(--md-sys-color-tertiary);
}

.legacy-list__item--conflict .legacy-list__icon {
  color: var(--md-sys-color-error);
}

.legacy-list__name {
  font: var(--md-sys-typescale-body-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.legacy-list__meta {
  flex: 1;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  font-family: var(--md-ref-typeface-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

.legacy-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  overflow: hidden;
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

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
  padding: 0 12px;
}

.spinner {
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid color-mix(in srgb, var(--md-sys-color-on-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-on-primary);
  animation: spinner-spin 0.8s linear infinite;
}

.spinner--small {
  width: 14px;
  height: 14px;
  border-width: 2px;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
</style>
