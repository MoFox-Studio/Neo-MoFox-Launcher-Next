<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import AppearanceSettings from '@/components/AppearanceSettings.vue';
import { useSettingsStore } from '@/stores/settings';
import { useWindowTitle } from '@/composables/use-window-title';
import { mofoxApi } from '@/services/mofox-api';
import type { LauncherSettings } from '@shared/domain/settings';
import type {
  LegacyLauncherInfo,
  MigrationPreview,
  MigrationResult,
} from '@shared/domain/migration';
import { MofoxError } from '@shared/domain/error';

// 设置页直接绑定持久化仓库，所有控件通过局部补丁提交更新。
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

// 设置页标题显示在窗口栏。
useWindowTitle({ title: '设置', subtitle: '调整启动器的外观、行为与数据选项' });

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
    <header class="settings-tabs">
      <div class="settings-tabs__inner">
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
          <span>自动保存</span>
        </div>
      </div>
    </header>

    <main class="settings-view__content">
      <!-- 外观、通用、网络、日志与版本信息分组 -->
      <!-- 外观 -->
      <AppearanceSettings v-show="activeCategory === 'appearance'" />

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
  --settings-sidebar-width: calc(240px + var(--app-nav-overlay-start-inset));

  position: relative;
  height: 100%;
  display: grid;
  grid-template-columns: var(--settings-sidebar-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

/* 只为右侧内容铺设主画布，让侧栏能直接模糊桌面材质或应用壁纸。 */
.settings-view::before {
  position: absolute;
  z-index: 0;
  inset: 0 0 0 var(--settings-sidebar-width);
  background: var(--app-current-content-surface);
  backdrop-filter: var(--app-current-content-filter);
  -webkit-backdrop-filter: var(--app-current-content-filter);
  content: '';
  pointer-events: none;
}

.settings-sidebar,
.settings-view__content {
  position: relative;
  z-index: 1;
}

/* 贴边导航抽屉使用较轻的内嵌玻璃层。 */
.settings-sidebar {
  grid-row: 1 / -1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 24px 12px calc(16px + var(--app-nav-overlay-bottom-inset))
    calc(12px + var(--app-nav-overlay-start-inset));
  border-right: 1px solid var(--app-glass-border);
  background: var(--app-subrail-surface);
  backdrop-filter: var(--app-subrail-filter);
  -webkit-backdrop-filter: var(--app-subrail-filter);
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
  min-width: 0;
  margin: 0 auto;
  padding: 20px var(--app-density-content-padding) calc(64px + var(--app-nav-overlay-bottom-inset));
  overflow-y: auto;
}

.settings-group {
  width: 100%;
  max-width: 824px;
  box-sizing: border-box;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--app-glass-border);
  border-radius: 20px;
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.settings-group__title {
  margin: 0;
  padding: 16px 16px 12px;
  font: var(--md-sys-typescale-title-small);
  color: var(--md-sys-color-primary);
}

.settings-group__card {
  overflow: hidden;
}

.settings-item {
  display: flex;
  align-items: center;
  padding: var(--app-density-row-padding-block) 16px;
  gap: 16px;
  min-height: var(--app-density-row-min-height);
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

.text-button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.settings-divider {
  height: 1px;
  background: var(--md-sys-color-outline-variant);
  margin: 0 16px;
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

@media (prefers-reduced-motion: reduce) {
  .md-switch__thumb {
    transition: background-color var(--md-sys-motion-duration-short4)
      var(--md-sys-motion-easing-standard);
  }
}

@media (max-width: 900px) {
  .settings-view {
    --settings-sidebar-width: 200px;
  }

  .settings-sidebar__description {
    display: none;
  }
}

@media (max-width: 680px) {
  .settings-view {
    --settings-sidebar-width: 0px;

    display: flex;
    flex-direction: column;
  }

  .settings-view::before {
    top: 61px;
  }

  .settings-view__content {
    flex: 1;
    padding: 16px 20px 40px;
  }

  .settings-sidebar {
    z-index: 2;
    width: 100%;
    min-height: 0;
    padding: 8px;
    border-right: 0;
    border-bottom: 1px solid var(--app-glass-border);
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
    padding: 14px 16px 10px;
  }

  .settings-item {
    flex-wrap: wrap;
  }

  .settings-item__body {
    min-width: calc(100% - 48px);
  }
}

/* InstallerX-style content navigation: one app navigation plus a compact connected selector. */
.settings-view {
  --settings-sidebar-width: 0px;

  display: flex;
  flex-direction: column;
  background: transparent;
}

.settings-view::before {
  display: none;
}

.settings-tabs {
  position: relative;
  z-index: 2;
  flex: none;
  padding: 18px 32px 10px calc(32px + var(--app-nav-overlay-start-inset));
}

.settings-tabs__inner {
  width: min(100%, 920px);
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 auto;
  padding: 8px;
  border-radius: 22px;
  background: var(--md-sys-color-surface-container-low);
}

.settings-sidebar__nav {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: row;
  gap: 3px;
}

.settings-sidebar__item {
  min-width: 0;
  min-height: 46px;
  flex: 1;
  justify-content: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--md-sys-color-surface-container);
  text-align: center;
}

.settings-sidebar__item:first-child {
  border-radius: 16px 6px 6px 16px;
}

.settings-sidebar__item:last-child {
  border-radius: 6px 16px 16px 6px;
}

.settings-sidebar__item--active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.settings-sidebar__icon {
  font-size: 20px;
}

.settings-sidebar__text {
  display: block;
}

.settings-sidebar__description {
  display: none;
}

.settings-sidebar__status {
  flex: none;
  margin: 0;
  padding: 0 10px;
  white-space: nowrap;
}

.settings-view__content {
  width: 100%;
  min-height: 0;
  display: block;
  flex: 1;
  padding: 8px 32px calc(40px + var(--app-nav-overlay-bottom-inset))
    calc(32px + var(--app-nav-overlay-start-inset));
}

.settings-group {
  max-width: 920px;
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.settings-group__title {
  padding: 4px 4px 12px;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-large);
}

.settings-group__card {
  display: grid;
  gap: 3px;
}

.settings-item {
  min-height: var(--app-density-row-min-height);
  padding: var(--app-density-row-padding-block) 18px;
  border-radius: 7px;
  background: var(--md-sys-color-surface-container-low);
}

.settings-group__card > .settings-item:first-child {
  border-radius: 20px 20px 7px 7px;
}

.settings-group__card > .settings-item:last-child {
  border-radius: 7px 7px 20px 20px;
}

.settings-group__card > .settings-item:first-child:last-child {
  border-radius: 20px;
}

.settings-divider {
  display: none;
}

.migration-note,
.migration-preview {
  margin-top: 3px;
  border-radius: 16px;
  background: var(--md-sys-color-surface-container-low);
}

@media (max-width: 760px) {
  .settings-tabs {
    padding: 12px 14px 8px calc(14px + var(--app-nav-overlay-start-inset));
  }

  .settings-tabs__inner {
    align-items: stretch;
    padding: 6px;
  }

  .settings-sidebar__nav {
    overflow-x: auto;
  }

  .settings-sidebar__item {
    width: auto;
    min-width: 102px;
    flex: 0 0 auto;
  }

  .settings-sidebar__status {
    display: none;
  }

  .settings-view__content {
    padding: 8px 18px calc(28px + var(--app-nav-overlay-bottom-inset))
      calc(18px + var(--app-nav-overlay-start-inset));
  }
}
</style>
