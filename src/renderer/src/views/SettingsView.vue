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

const settingCategories = [
  { id: 'appearance', label: '外观', description: '主题、颜色与语言', icon: 'palette' },
  { id: 'general', label: '通用', description: '目录与运行行为', icon: 'tune' },
  { id: 'migration', label: '数据迁移', description: '导入旧版实例', icon: 'cloud_sync' },
  { id: 'logs', label: '日志', description: '归档与存储限制', icon: 'article' },
  { id: 'about', label: '关于', description: '版本与更新信息', icon: 'info' },
] as const;

type SettingsCategoryId = (typeof settingCategories)[number]['id'];

const activeCategory = ref<SettingsCategoryId>('appearance');

function onLanguageChange(event: Event): void {
  update({ language: (event.target as HTMLSelectElement).value as LauncherSettings['language'] });
}

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

// 安装目录通过通用对话框 IPC 选择；用户取消时不修改设置。错误复用迁移区块的提示位展示。
const installDirBusy = ref(false);

async function chooseInstallDir(): Promise<void> {
  if (installDirBusy.value) return;
  installDirBusy.value = true;
  try {
    const picked = await mofoxApi.pickDirectory({
      title: '选择默认安装目录',
      defaultPath: settings.value.defaultInstallDir || undefined,
    });
    if (picked) update({ defaultInstallDir: picked });
  } catch (error) {
    migrationError.value = describeError(error);
  } finally {
    installDirBusy.value = false;
  }
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
    <aside class="settings-sidebar">
      <nav class="settings-sidebar__nav" aria-label="设置分类">
        <button
          v-for="category in settingCategories"
          :key="category.id"
          class="settings-sidebar__item state-layer"
          :class="{ 'settings-sidebar__item--active': activeCategory === category.id }"
          type="button"
          :aria-current="activeCategory === category.id ? 'page' : undefined"
          @click="activeCategory = category.id"
        >
          <span
            class="msr settings-sidebar__icon"
            :class="{ 'msr--fill': activeCategory === category.id }"
            aria-hidden="true"
          >
            {{ category.icon }}
          </span>
          <span class="settings-sidebar__text">
            <span class="settings-sidebar__label">{{ category.label }}</span>
            <span class="settings-sidebar__description">{{ category.description }}</span>
          </span>
        </button>
      </nav>
      <div class="settings-sidebar__status">
        <span class="msr settings-sidebar__status-icon" aria-hidden="true">cloud_done</span>
        <span>更改将自动保存</span>
      </div>
    </aside>

    <header class="settings-view__header">
      <h1 class="settings-view__title">设置</h1>
      <p class="settings-view__subtitle">调整启动器的外观、行为与数据选项</p>
    </header>

    <main class="settings-view__content">
      <!-- 外观、通用、网络、日志与版本信息分组 -->
      <!-- 外观 -->
      <section v-show="activeCategory === 'appearance'" class="settings-group">
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
            <md-outlined-select
              class="language-select"
              label="语言"
              :value="settings.language"
              @change="onLanguageChange"
            >
              <!-- Material Web Components 使用原生具名插槽，而不是 Vue 模板插槽。 -->
              <!-- eslint-disable vue/no-deprecated-slot-attribute -->
              <md-select-option value="zh-CN">
                <div slot="headline">简体中文</div>
              </md-select-option>
              <md-select-option value="en-US">
                <div slot="headline">English</div>
              </md-select-option>
              <!-- eslint-enable vue/no-deprecated-slot-attribute -->
            </md-outlined-select>
          </div>
        </div>
      </section>

      <!-- 通用 -->
      <section v-show="activeCategory === 'general'" class="settings-group">
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
            <button
              class="text-button state-layer"
              :disabled="installDirBusy"
              @click="chooseInstallDir"
            >
              更改
            </button>
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

      <!-- 数据迁移 -->
      <section v-show="activeCategory === 'migration'" class="settings-group">
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
      <section v-show="activeCategory === 'logs'" class="settings-group">
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
      <section v-show="activeCategory === 'about'" class="settings-group">
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
    </main>
  </div>
</template>

<style scoped>
/* 设置页滚动布局与分组卡片 */
.settings-view {
  height: 100%;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: var(--md-sys-color-surface);
}

.settings-view__header {
  grid-column: 2;
  max-width: 824px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px 20px;
}

.settings-view__title {
  margin: 0;
  font: var(--md-sys-typescale-headline-small);
  color: var(--md-sys-color-on-surface);
}

.settings-view__subtitle {
  margin: 4px 0 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

/* 贴边导航抽屉沿用 MD3 表面与选中指示器，仅以透明度和模糊增强层次。 */
.settings-sidebar {
  grid-row: 1 / -1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 24px 12px 16px;
  border-right: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 72%, transparent);
  background: color-mix(in srgb, var(--md-sys-color-surface-container-low) 82%, transparent);
  backdrop-filter: blur(20px) saturate(125%);
  -webkit-backdrop-filter: blur(20px) saturate(125%);
}

.settings-sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-sidebar__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 16px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.settings-sidebar__item--active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.settings-sidebar__icon {
  flex: 0 0 auto;
  font-size: 24px;
}

.settings-sidebar__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.settings-sidebar__label {
  font: var(--md-sys-typescale-label-large);
}

.settings-sidebar__description {
  overflow: hidden;
  color: inherit;
  font: var(--md-sys-typescale-body-small);
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-sidebar__status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding: 12px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.settings-sidebar__status-icon {
  color: var(--md-sys-color-primary);
  font-size: 18px;
}

.settings-view__content {
  grid-column: 2;
  width: 100%;
  max-width: 824px;
  min-width: 0;
  margin: 0 auto;
  padding: 0 32px 64px;
  overflow-y: auto;
}

.settings-group__title {
  margin: 12px 0 12px;
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

/* MD3 Web 下拉框与文本操作按钮 */
.language-select {
  min-width: 150px;
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
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch__thumb {
  position: absolute;
  top: 50%;
  left: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-on-surface-variant);
  transform: translate(0, -50%) scale(0.6667);
  transform-origin: center;
  transition:
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch--checked {
  background: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.md-switch--checked .md-switch__thumb {
  background: var(--md-sys-color-on-primary);
  transform: translate(20px, -50%) scale(1);
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

@media (max-width: 900px) {
  .settings-view {
    grid-template-columns: 200px minmax(0, 1fr);
  }

  .settings-sidebar__description {
    display: none;
  }
}

@media (max-width: 680px) {
  .settings-view {
    display: flex;
    flex-direction: column;
  }

  .settings-view__header {
    flex: 0 0 auto;
    padding: 20px 20px 16px;
  }

  .settings-view__content {
    flex: 1;
    padding: 0 20px 40px;
  }

  .settings-sidebar {
    z-index: 2;
    width: 100%;
    min-height: 0;
    padding: 8px;
    border-right: 0;
    border-bottom: 1px solid
      color-mix(in srgb, var(--md-sys-color-outline-variant) 72%, transparent);
  }

  .settings-sidebar__nav {
    flex-direction: row;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .settings-sidebar__nav::-webkit-scrollbar {
    display: none;
  }

  .settings-sidebar__item {
    flex: 0 0 auto;
    width: auto;
    min-height: 44px;
    padding: 6px 12px;
  }

  .settings-sidebar__icon {
    font-size: 20px;
  }

  .settings-sidebar__description,
  .settings-sidebar__status {
    display: none;
  }

  .settings-group__title {
    margin-top: 0;
  }

  .settings-item {
    flex-wrap: wrap;
  }

  .settings-item__body {
    min-width: calc(100% - 48px);
  }

  .segmented-button {
    margin-left: 40px;
  }

  .segmented-button__item {
    padding: 0 12px;
  }

  .color-palette,
  .language-select {
    margin-left: 40px;
  }
}
</style>
