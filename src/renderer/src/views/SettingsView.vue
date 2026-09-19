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
    <aside class="settings-sidebar" aria-label="设置侧栏">
      <h2 class="settings-sidebar__heading">设置</h2>
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
    </aside>

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

          <div v-if="false" class="settings-item">
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

          <div v-if="false" class="settings-item">
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

<style scoped src="./SettingsView.css"></style>
