<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '@/stores/settings';
import { mofoxApi } from '@/services/mofox-api';
import type {
  LauncherSettings,
  LegacyLauncherInfo,
  MigrationPreview,
  MigrationResult,
} from '@shared/domain/instance';
import { MofoxError } from '@shared/domain/error';

// 设置页直接绑定持久化仓库，所有控件通过局部补丁提交更新。
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const update = (patch: Partial<LauncherSettings>) => {
  settingsStore.update(patch);
};

const presetColors = ['#7C5CDB', '#B3261E', '#006A6A', '#9C4400', '#386A20', '#345CA8'];

const isPresetColor = (color: string) => presetColors.includes(color.toUpperCase());

// 数值设置在提交前限制到字段允许范围，避免无效配置写入。
const handleNumberInput = (key: keyof LauncherSettings, event: Event, min: number, max: number) => {
  const input = event.target as HTMLInputElement;
  let val = parseInt(input.value);
  if (isNaN(val)) return;
  if (val < min) val = min;
  if (val > max) val = max;
  update({ [key]: val });
};

// ─── 旧启动器数据迁移 ───────────────────────────────────────────────────
// 四态流程：空闲 → 已检测 → 已预览 → 已完成；busy 标志独立跟踪异步执行。
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
  // 进入设置页时静默探测一次旧启动器；存在则直接进入“已检测”态以减少手动操作。
  void detectLegacy();
});
</script>

<template>
  <div class="settings-view">
    <header class="settings-view__header">
      <h1 class="settings-view__title">设置</h1>
    </header>

    <div class="settings-view__content">
      <!-- 外观、通用、网络、日志与版本信息分组 -->
      <!-- 外观 -->
      <section class="settings-group">
        <h2 class="settings-group__title">外观</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">routine</span>
            <div class="settings-item__body">
              <span class="settings-item__label">主题模式</span>
            </div>
            <div class="segmented-button">
              <button
                class="segmented-button__item state-layer"
                :class="{ 'segmented-button__item--selected': settings.themeMode === 'system' }"
                @click="update({ themeMode: 'system' })"
                role="radio"
                :aria-checked="settings.themeMode === 'system'"
              >
                <span v-if="settings.themeMode === 'system'" class="msr segmented-button__check"
                  >check</span
                >
                <span>跟随系统</span>
              </button>
              <button
                class="segmented-button__item state-layer"
                :class="{ 'segmented-button__item--selected': settings.themeMode === 'light' }"
                @click="update({ themeMode: 'light' })"
                role="radio"
                :aria-checked="settings.themeMode === 'light'"
              >
                <span v-if="settings.themeMode === 'light'" class="msr segmented-button__check"
                  >check</span
                >
                <span>浅色</span>
              </button>
              <button
                class="segmented-button__item state-layer"
                :class="{ 'segmented-button__item--selected': settings.themeMode === 'dark' }"
                @click="update({ themeMode: 'dark' })"
                role="radio"
                :aria-checked="settings.themeMode === 'dark'"
              >
                <span v-if="settings.themeMode === 'dark'" class="msr segmented-button__check"
                  >check</span
                >
                <span>深色</span>
              </button>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">palette</span>
            <div class="settings-item__body">
              <span class="settings-item__label">主题色</span>
            </div>
            <div class="color-palette">
              <button
                v-for="color in presetColors"
                :key="color"
                class="color-dot state-layer"
                :class="{ 'color-dot--selected': settings.seedColor.toUpperCase() === color }"
                :style="{ backgroundColor: color }"
                @click="update({ seedColor: color })"
              ></button>
              <div
                class="color-dot color-dot--custom"
                :class="{ 'color-dot--selected': !isPresetColor(settings.seedColor) }"
              >
                <input
                  type="color"
                  class="color-dot__input"
                  :value="settings.seedColor"
                  @input="(e) => update({ seedColor: (e.target as HTMLInputElement).value })"
                />
              </div>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">language</span>
            <div class="settings-item__body">
              <span class="settings-item__label">语言</span>
            </div>
            <div class="select-wrapper">
              <select
                class="native-select"
                :value="settings.language"
                @change="(e) => update({ language: (e.target as HTMLSelectElement).value as any })"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
              <span class="msr select-wrapper__arrow">arrow_drop_down</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 通用 -->
      <section class="settings-group">
        <h2 class="settings-group__title">通用</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">folder</span>
            <div class="settings-item__body">
              <span class="settings-item__label">默认安装目录</span>
              <span class="settings-item__desc settings-item__desc--mono">{{
                settings.defaultInstallDir
              }}</span>
            </div>
            <button class="text-button state-layer">更改</button>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">pip</span>
            <div class="settings-item__body">
              <span class="settings-item__label">关闭时最小化到托盘</span>
            </div>
            <div
              class="md-switch"
              role="switch"
              :aria-checked="settings.closeToTray"
              :class="{ 'md-switch--checked': settings.closeToTray }"
              @click="update({ closeToTray: !settings.closeToTray })"
            >
              <div class="md-switch__thumb"></div>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">speed</span>
            <div class="settings-item__body">
              <span class="settings-item__label">硬件加速</span>
              <span class="settings-item__desc">更改后需重启启动器生效</span>
            </div>
            <div
              class="md-switch"
              role="switch"
              :aria-checked="settings.hardwareAcceleration"
              :class="{ 'md-switch--checked': settings.hardwareAcceleration }"
              @click="update({ hardwareAcceleration: !settings.hardwareAcceleration })"
            >
              <div class="md-switch__thumb"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 日志 -->
      <section class="settings-group">
        <h2 class="settings-group__title">数据迁移</h2>
        <div class="settings-group__card">
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
          <div v-if="migrationError" class="settings-divider"></div>
          <div v-if="migrationError" class="migration-note migration-note--error">
            <span class="msr migration-note__icon">error</span>
            <span>{{ migrationError }}</span>
          </div>

          <!-- 预览结果：列出待导入实例与冲突项 -->
          <template v-if="migrationPreview">
            <div class="settings-divider"></div>
            <div class="migration-preview">
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
                      {{ entry.instance.platformId }} · {{ entry.instance.installPath }}
                    </span>
                  </div>
                  <span v-if="entry.conflict" class="migration-preview__tag">
                    {{ entry.conflict === 'duplicate-id' ? 'ID 冲突' : '路径冲突' }}
                  </span>
                </li>
              </ul>
            </div>
          </template>

          <!-- 导入完成统计 -->
          <template v-if="migrationResult">
            <div class="settings-divider"></div>
            <div class="migration-note migration-note--ok">
              <span class="msr migration-note__icon">check_circle</span>
              <span>
                导入 {{ migrationResult.imported }} 个，跳过 {{ migrationResult.skipped }} 个， 共
                {{ migrationResult.total }} 个实例
              </span>
            </div>
          </template>
        </div>
      </section>

      <!-- 日志 -->
      <section class="settings-group">
        <h2 class="settings-group__title">日志</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">hard_drive</span>
            <div class="settings-item__body">
              <span class="settings-item__label">单文件上限</span>
            </div>
            <div class="input-field">
              <input
                type="number"
                class="input-field__native"
                :value="settings.maxLogFileSizeMb"
                @change="(e) => handleNumberInput('maxLogFileSizeMb', e, 1, 512)"
              />
              <span class="input-field__suffix">MB</span>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">history</span>
            <div class="settings-item__body">
              <span class="settings-item__label">归档保留天数</span>
            </div>
            <div class="input-field">
              <input
                type="number"
                class="input-field__native"
                :value="settings.maxLogArchiveDays"
                @change="(e) => handleNumberInput('maxLogArchiveDays', e, 1, 90)"
              />
              <span class="input-field__suffix">天</span>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">folder_zip</span>
            <div class="settings-item__body">
              <span class="settings-item__label">压缩归档日志</span>
            </div>
            <div
              class="md-switch"
              role="switch"
              :aria-checked="settings.compressLogArchive"
              :class="{ 'md-switch--checked': settings.compressLogArchive }"
              @click="update({ compressLogArchive: !settings.compressLogArchive })"
            >
              <div class="md-switch__thumb"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 关于 -->
      <section class="settings-group">
        <h2 class="settings-group__title">关于</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">info</span>
            <div class="settings-item__body">
              <span class="settings-item__label">Neo-MoFox Launcher</span>
              <span class="settings-item__desc">版本 0.1.0</span>
            </div>
            <button class="text-button state-layer">检查更新</button>
          </div>
          <div class="settings-divider"></div>
          <div class="settings-item">
            <span class="msr settings-item__icon">description</span>
            <div class="settings-item__body">
              <span class="settings-item__desc">基于 Electron · Vue 3 · Material Design 3</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 设置页滚动布局与分组卡片 */
.settings-view {
  height: 100%;
  overflow-y: auto;
  background: var(--md-sys-color-surface);
}

.settings-view__header {
  padding: 24px 32px;
}

.settings-view__title {
  margin: 0;
  font: var(--md-sys-typescale-headline-small);
  color: var(--md-sys-color-on-surface);
}

.settings-view__content {
  max-width: 760px;
  margin: 0 auto;
  padding: 0 32px 64px;
}

.settings-group__title {
  margin: 32px 0 12px;
  font: var(--md-sys-typescale-title-small);
  color: var(--md-sys-color-primary);
}

.settings-group__card {
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
}

.settings-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 16px;
  min-height: 56px;
}

.settings-item__icon {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 24px;
}

.settings-item__body {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.settings-item__label {
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface);
}

.settings-item__desc {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.settings-item__desc--mono {
  font-family: var(--md-ref-typeface-mono);
}

.settings-divider {
  height: 1px;
  background: var(--md-sys-color-outline-variant);
  margin: 0 16px;
}

/* 分段主题选择与颜色选择器 */
.segmented-button {
  display: flex;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-full);
  overflow: hidden;
}

.segmented-button__item {
  height: 40px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  border-right: 1px solid var(--md-sys-color-outline);
  position: relative;
}

.segmented-button__item:last-child {
  border-right: none;
}

.segmented-button__item--selected {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.segmented-button__check {
  font-size: 18px;
}

/* 颜色调色板 */
.color-palette {
  display: flex;
  gap: 12px;
}

.color-dot {
  width: 24px;
  height: 24px;
  border-radius: var(--md-sys-shape-corner-full);
  border: none;
  cursor: pointer;
  position: relative;
}

.color-dot--selected {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 3px;
}

.color-dot--custom {
  background: conic-gradient(
    from 0deg,
    #ff0000,
    #ffff00,
    #00ff00,
    #00ffff,
    #0000ff,
    #ff00ff,
    #ff0000
  );
}

.color-dot__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

/* 原生下拉框与文本操作按钮 */
.select-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-small);
  padding: 0 12px;
  min-width: 120px;
}

.native-select {
  appearance: none;
  background: transparent;
  border: none;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  width: 100%;
  height: 40px;
  padding-right: 24px;
  outline: none;
  cursor: pointer;
}

.select-wrapper__arrow {
  position: absolute;
  right: 8px;
  pointer-events: none;
  color: var(--md-sys-color-on-surface-variant);
}

/* 文本按钮 */
.text-button {
  background: transparent;
  border: none;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
  padding: 10px 12px;
  border-radius: var(--md-sys-shape-corner-full);
  cursor: pointer;
  position: relative;
}

/* 开关控件与数值输入框 */
.md-switch {
  width: 52px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  border: 2px solid var(--md-sys-color-outline);
  position: relative;
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch__thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-on-surface-variant);
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch--checked {
  background: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.md-switch--checked .md-switch__thumb {
  left: 20px;
  width: 24px;
  height: 24px;
  background: var(--md-sys-color-on-primary);
}

/* 数值输入框 */
.input-field {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-extra-small);
  padding: 0 12px;
  height: 40px;
  min-width: 100px;
}

.input-field:focus-within {
  border: 2px solid var(--md-sys-color-primary);
  padding: 0 11px;
}

.input-field__native {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  outline: none;
  text-align: right;
}

.input-field__native::-webkit-inner-spin-button,
.input-field__native::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}

.input-field__suffix {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
}

/* 数据迁移：预览列表与状态提示 */
.migration-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  font: var(--md-sys-typescale-body-medium);
}

.migration-note--error {
  color: var(--md-sys-color-error);
}

.migration-note--ok {
  color: var(--md-sys-color-tertiary);
}

.migration-note__icon {
  font-size: 20px;
}

.migration-preview {
  padding: 12px 16px;
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
