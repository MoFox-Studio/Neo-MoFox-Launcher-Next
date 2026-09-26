<script setup lang="ts">
// 数据迁移面板：合并原「数据迁移」与「高级」分区。
// 迁移为四态流程：空闲 → 已检测 → 已预览 → 已完成；busy 标志独立跟踪异步执行。
import { onMounted, ref } from 'vue';
import type { DataFileKind } from '@shared/ipc';
import type {
  LegacyLauncherInfo,
  MigrationPreview,
  MigrationResult,
} from '@shared/domain/migration';
import { MofoxError } from '@shared/domain/error';
import { mofoxApi } from '@/services/mofox-api';

type MigrationPhase = 'idle' | 'detected' | 'previewed' | 'done';

const migrationPhase = ref<MigrationPhase>('idle');
const migrationBusy = ref(false);
const migrationError = ref<string | null>(null);
const legacyInfo = ref<LegacyLauncherInfo | null>(null);
const migrationPreview = ref<MigrationPreview | null>(null);
const migrationResult = ref<MigrationResult | null>(null);

function resetMigration(): void {
  migrationPhase.value = 'idle';
  migrationError.value = null;
  legacyInfo.value = null;
  migrationPreview.value = null;
  migrationResult.value = null;
}

function describeError(error: unknown): string {
  if (error instanceof MofoxError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}

async function detectLegacy(): Promise<void> {
  migrationBusy.value = true;
  migrationError.value = null;
  try {
    legacyInfo.value = await mofoxApi.detectLegacyLauncher();
    migrationPhase.value = legacyInfo.value ? 'detected' : 'idle';
    if (!legacyInfo.value) migrationError.value = '未检测到旧启动器数据目录';
  } catch (error) {
    migrationError.value = describeError(error);
  } finally {
    migrationBusy.value = false;
  }
}

async function previewMigration(): Promise<void> {
  migrationBusy.value = true;
  migrationError.value = null;
  try {
    migrationPreview.value = await mofoxApi.previewLegacyMigration();
    migrationPhase.value = 'previewed';
  } catch (error) {
    migrationError.value = describeError(error);
  } finally {
    migrationBusy.value = false;
  }
}

async function importMigration(): Promise<void> {
  migrationBusy.value = true;
  migrationError.value = null;
  try {
    migrationResult.value = await mofoxApi.importLegacyMigration();
    migrationPhase.value = 'done';
  } catch (error) {
    migrationError.value = describeError(error);
  } finally {
    migrationBusy.value = false;
  }
}

onMounted(() => {
  // 进入数据迁移面板时静默探测一次旧启动器；存在则直接进入“已检测”态以减少手动操作。
  void detectLegacy();
});

// ─── 数据文件 ───────────────────────────────────────────────────────────
// 通过主进程按符号名打开启动器源数据文件；渲染端不传递任意路径。
// 点击后按钮立即复位，不等待打开结果；仅在打开失败时于提示位报错。
const dataFileError = ref<string | null>(null);

function openDataFile(kind: DataFileKind): void {
  dataFileError.value = null;
  mofoxApi.openDataFile(kind).catch((error: unknown) => {
    dataFileError.value = describeError(error);
  });
}
</script>

<template>
  <div class="settings-group">
    <!-- 数据迁移 -->
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">cloud_sync</span>
        <div>
          <h2>数据迁移</h2>
          <p>导入旧版实例</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">cloud_sync</span>
          <div class="settings-item__body">
            <span class="settings-item__label">从旧启动器导入实例</span>
            <span class="settings-item__desc" v-if="legacyInfo">
              {{ legacyInfo.dataDirectory }} · {{ legacyInfo.instanceCount }} 个实例
            </span>
            <span class="settings-item__desc" v-else>
              检测旧启动器（Neo-MoFox-Launcher）数据目录并导入其实例
            </span>
          </div>
          <button
            v-if="migrationPhase === 'idle'"
            class="text-button state-layer"
            :disabled="migrationBusy"
            @click="detectLegacy"
          >
            检测
          </button>
          <button
            v-else-if="migrationPhase === 'detected'"
            class="text-button state-layer"
            :disabled="migrationBusy"
            @click="previewMigration"
          >
            预览
          </button>
          <button
            v-else-if="migrationPhase === 'previewed'"
            class="text-button state-layer"
            :disabled="migrationBusy"
            @click="importMigration"
          >
            导入
          </button>
          <button
            v-else
            class="text-button state-layer"
            :disabled="migrationBusy"
            @click="resetMigration"
          >
            重置
          </button>
        </div>

        <!-- 检测失败提示 -->
        <div v-if="migrationError" class="settings-note settings-note--error">
          <span class="msr settings-note__icon">error</span>
          <span>{{ migrationError }}</span>
        </div>

        <!-- 预览结果：列出待导入实例与冲突项 -->
        <div v-if="migrationPreview" class="migration-preview">
          <p class="migration-preview__hint">
            共 {{ migrationPreview.previews.length }} 条记录，
            <span class="migration-preview__conflict">
              {{ migrationPreview.previews.filter((p) => p.conflict).length }} 条冲突将被跳过
            </span>
          </p>
          <ul class="migration-preview__list">
            <li
              v-for="entry in migrationPreview.previews"
              :key="entry.instance.id"
              class="migration-preview__item"
              :class="{ 'migration-preview__item--conflict': entry.conflict }"
            >
              <span class="msr migration-preview__icon">{{
                entry.conflict ? 'block' : 'check_circle'
              }}</span>
              <div class="migration-preview__text">
                <span class="migration-preview__name">{{ entry.instance.name }}</span>
                <span class="migration-preview__meta">
                  {{ entry.instance.platform?.id ?? '' }} ·
                  {{ entry.instance.mofoxInstallDir }}
                </span>
              </div>
              <span v-if="entry.conflict" class="migration-preview__tag">
                {{ entry.conflict === 'duplicate-id' ? 'ID 冲突' : '路径冲突' }}
              </span>
            </li>
          </ul>
        </div>

        <!-- 导入完成统计 -->
        <div v-if="migrationResult" class="settings-note settings-note--ok">
          <span class="msr settings-note__icon">check_circle</span>
          <span>
            导入 {{ migrationResult.imported }} 个，跳过 {{ migrationResult.skipped }} 个， 共
            {{ migrationResult.total }} 个实例
          </span>
        </div>
      </div>
    </section>

    <!-- 高级 -->
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">data_object</span>
        <div>
          <h2>高级</h2>
          <p>打开设置与实例源文件</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">description</span>
          <div class="settings-item__body">
            <span class="settings-item__label">设置源文件</span>
            <span class="settings-item__desc settings-item__desc--mono">
              launcher-settings.json
            </span>
          </div>
          <button class="text-button state-layer" @click="openDataFile('settings')">打开</button>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">folder_special</span>
          <div class="settings-item__body">
            <span class="settings-item__label">实例源文件</span>
            <span class="settings-item__desc settings-item__desc--mono">instances.json</span>
          </div>
          <button class="text-button state-layer" @click="openDataFile('instances')">打开</button>
        </div>

        <!-- 打开失败提示 -->
        <div v-if="dataFileError" class="settings-note settings-note--error">
          <span class="msr settings-note__icon">error</span>
          <span>{{ dataFileError }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped src="./settings-panel.css"></style>

<style scoped>
/* 数据迁移：预览列表（卡片内的内嵌块） */
.migration-preview {
  padding: 12px 16px;
  border-radius: 7px;
  background: var(--app-glass-row);
}

.migration-preview__hint {
  margin: 0 0 8px;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.migration-preview__conflict {
  color: var(--md-sys-color-error);
}

.migration-preview__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}

.migration-preview__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.migration-preview__item--conflict {
  opacity: 0.65;
}

.migration-preview__icon {
  font-size: 18px;
  color: var(--md-sys-color-tertiary);
}

.migration-preview__item--conflict .migration-preview__icon {
  color: var(--md-sys-color-error);
}

.migration-preview__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.migration-preview__name {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.migration-preview__meta {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--md-ref-typeface-mono);
}

.migration-preview__tag {
  font: var(--md-sys-typescale-label-small);
  color: var(--md-sys-color-error);
  border: 1px solid var(--md-sys-color-error);
  border-radius: var(--md-sys-shape-corner-full);
  padding: 2px 8px;
  white-space: nowrap;
}
</style>
