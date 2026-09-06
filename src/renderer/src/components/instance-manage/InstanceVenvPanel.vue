<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Instance } from '@shared/domain/instance';
import type { VenvInfo, VenvProgressEvent } from '@shared/domain/venv';
import { mofoxApi } from '@/services/mofox-api';
import BaseDialog from '@/components/BaseDialog.vue';
import ErrorDialog from '@/components/ErrorDialog.vue';

// 虚拟环境面板：展示实例 venv 目录下的包列表与可升级依赖，
// 支持安装、卸载与升级单个包，并提供「升级全部」与镜像轮询安装。
// 安装必须先搜索包名，搜索后按版本逐条展示并直接安装到指定版本；
// 升级依赖期间通过 venv-progress 事件驱动进度弹窗。
const props = defineProps<{
  instance: Instance;
}>();

const emit = defineEmits<{
  toast: [message: string];
}>();

const info = ref<VenvInfo | null>(null);
const loading = ref(false);
const refreshing = ref(false);

const uninstalling = ref<string | null>(null);
const upgrading = ref<string | null>(null);
const upgradingAll = ref(false);

// 升级依赖进度弹窗：由主进程 venv-progress 事件驱动。
const venvProgress = ref<VenvProgressEvent | null>(null);

// 安装依赖弹窗：先输入包名并搜索，搜索结果以版本列表形式展示，安装直接放在各版本行。
const installOpen = ref(false);
const installName = ref('');
const installSearched = ref(false);
const installVersions = ref<string[]>([]);
const installQuerying = ref(false);
const installingVersion = ref<string | null>(null);
const installError = ref('');

const errorDialog = ref<{ title: string; description: string } | null>(null);

const packages = computed(() => info.value?.packages ?? []);
const upgrades = computed(() => info.value?.upgrades ?? []);
const hasUpgrades = computed(() => info.value?.hasUpgrades ?? false);
const venvValid = computed(() => info.value?.valid ?? false);
const pythonExists = computed(() => info.value?.pythonExists ?? false);

// 升级操作进行中（任一进度事件未结束）时展示覆盖层弹窗。
const upgradeBusy = computed(() => venvProgress.value !== null);

// 搜索结果中当前已安装的同名包版本；已安装版本不再提供重复安装入口。
const installedVersionOfSearched = computed(() => {
  const name = installName.value.trim();
  if (!name) return null;
  return packages.value.find((p) => p.name.toLowerCase() === name.toLowerCase())?.version ?? null;
});

const venvBadgeText = computed(() => {
  if (loading.value) return '加载中…';
  if (!venvValid.value) return pythonExists.value ? '环境不完整' : '虚拟环境未创建';
  return `已安装 ${packages.value.length} 个依赖`;
});

const venvBadgeClass = computed(() => {
  if (loading.value) return '';
  return venvValid.value ? 'update-head__badge--ok' : 'update-head__badge--warn';
});

// 未升级的包视为可升级目标；升级按钮仅对存在可用新版（upgrades）的包可点击。
const upgradableNames = computed(() => new Set(upgrades.value.map((u) => u.name.toLowerCase())));

function isUpgradable(name: string): boolean {
  return upgradableNames.value.has(name.toLowerCase());
}

function latestOf(name: string): string {
  return (
    upgrades.value.find((u) => u.name.toLowerCase() === name.toLowerCase())?.latest ?? '最新版'
  );
}

function packageLabel(name: string): string {
  return packages.value.find((p) => p.name.toLowerCase() === name.toLowerCase())?.name ?? name;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    info.value = await mofoxApi.getVenvInfo(props.instance.id);
  } catch (error) {
    emit(
      'toast',
      `虚拟环境信息加载失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    loading.value = false;
  }
}

async function refresh(): Promise<void> {
  refreshing.value = true;
  try {
    info.value = await mofoxApi.getVenvInfo(props.instance.id);
  } catch (error) {
    emit('toast', `刷新失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    refreshing.value = false;
  }
}

/** 安装指定版本；版本必须来自搜索结果，安装入口只出现在版本列表中。 */
async function installPackage(name: string, version: string): Promise<void> {
  if (!installSearched.value) return;
  installingVersion.value = version;
  installError.value = '';
  try {
    const result = await mofoxApi.installVenvPackage(props.instance.id, name, version);
    if (!result.ok) {
      throw new Error(result.message ?? `安装 ${name} 失败`);
    }
    installOpen.value = false;
    emit('toast', `已安装 ${name} ${version}`);
    await refresh();
  } catch (error) {
    installError.value = error instanceof Error ? error.message : String(error);
  } finally {
    installingVersion.value = null;
  }
}

/** 搜索包名可用版本；搜索成功前不提供任何安装入口。 */
async function searchVersions(): Promise<void> {
  const name = installName.value.trim();
  if (!name) {
    installError.value = '请输入包名';
    return;
  }
  installQuerying.value = true;
  installError.value = '';
  installSearched.value = false;
  installVersions.value = [];
  try {
    installVersions.value = await mofoxApi.queryVenvPackageVersions(props.instance.id, name);
    installSearched.value = true;
    if (installVersions.value.length === 0) installError.value = '未找到该包的可用版本';
  } catch (error) {
    installError.value = `查询版本失败: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    installQuerying.value = false;
  }
}

function openInstallDialog(): void {
  installName.value = '';
  installSearched.value = false;
  installVersions.value = [];
  installError.value = '';
  installOpen.value = true;
}

function closeInstallDialog(): void {
  if (installingVersion.value !== null) return;
  installOpen.value = false;
}

async function uninstall(name: string): Promise<void> {
  uninstalling.value = name;
  try {
    const result = await mofoxApi.uninstallVenvPackage(props.instance.id, name);
    if (!result.ok) throw new Error(result.message ?? `卸载 ${name} 失败`);
    emit('toast', `已卸载 ${name}`);
    await refresh();
  } catch (error) {
    errorDialog.value = {
      title: '卸载失败',
      description: error instanceof Error ? error.message : String(error),
    };
  } finally {
    uninstalling.value = null;
  }
}

async function upgrade(name: string): Promise<void> {
  upgrading.value = name;
  try {
    const result = await mofoxApi.updateVenvPackage(props.instance.id, name);
    if (!result.ok) throw new Error(result.message ?? `升级 ${name} 失败`);
    emit('toast', `已升级 ${name}`);
    await refresh();
  } catch (error) {
    venvProgress.value = null;
    errorDialog.value = {
      title: '升级失败',
      description: error instanceof Error ? error.message : String(error),
    };
  } finally {
    upgrading.value = null;
  }
}

async function upgradeAll(): Promise<void> {
  upgradingAll.value = true;
  try {
    const result = await mofoxApi.updateVenvPackage(props.instance.id);
    if (!result.ok) throw new Error(result.message ?? '升级全部依赖失败');
    emit('toast', '已升级全部可升级依赖');
    await refresh();
  } catch (error) {
    venvProgress.value = null;
    errorDialog.value = {
      title: '升级失败',
      description: error instanceof Error ? error.message : String(error),
    };
  } finally {
    upgradingAll.value = false;
  }
}

function onNameInput(): void {
  if (installError.value) installError.value = '';
  // 包名变化后旧搜索结果不再有效，必须重新搜索才能安装。
  if (installSearched.value) {
    installSearched.value = false;
    installVersions.value = [];
  }
}

let unsubscribeVenvProgress: (() => void) | null = null;

// 主程序路径变化时跟随刷新（虚拟环境路径由父组件在编辑时自动跟随）。
watch(
  () => props.instance.venvDir,
  () => {
    void refresh();
  },
);

onMounted(() => {
  void load();
  // 只接收当前实例的升级进度，驱动顶部进度弹窗；完成或出错后关闭。
  unsubscribeVenvProgress = mofoxApi.on('venv-progress', (event) => {
    if (event.instanceId !== props.instance.id) return;
    if (event.phase !== 'upgrade' && event.phase !== 'upgrade-all') return;
    if (event.error) {
      venvProgress.value = null;
      errorDialog.value = { title: '升级失败', description: event.error };
      return;
    }
    if (event.percent >= 1) {
      venvProgress.value = null;
      return;
    }
    venvProgress.value = event;
  });
});

onBeforeUnmount(() => {
  unsubscribeVenvProgress?.();
});
</script>

<template>
  <div class="venv-view">
    <!-- 顶部工具条：虚拟环境摘要 + 刷新 / 安装依赖 / 升级全部 -->
    <div class="update-toolbar venv-toolbar">
      <div class="update-head">
        <div class="update-head__info">
          <span class="msr update-head__icon" aria-hidden="true">science</span>
          <div class="venv-head__text">
            <h2 class="update-head__title">虚拟环境</h2>
            <span v-if="!loading" class="update-head__badge" :class="venvBadgeClass">
              {{ venvBadgeText }}
            </span>
          </div>
        </div>
        <div class="venv-head__actions">
          <button
            class="btn btn--tonal state-layer"
            type="button"
            :disabled="refreshing"
            @click="refresh"
          >
            <span class="msr btn__icon" aria-hidden="true">refresh</span>
            {{ refreshing ? '刷新中…' : '刷新' }}
          </button>
          <button
            class="btn btn--filled state-layer"
            type="button"
            :disabled="refreshing"
            @click="openInstallDialog"
          >
            <span class="msr btn__icon" aria-hidden="true">add</span>
            安装依赖
          </button>
        </div>
      </div>
      <div class="venv-overview">
        <div class="update-item">
          <span class="update-item__label">环境路径</span>
          <span class="update-value update-value--mono">{{ instance.venvDir || '—' }}</span>
        </div>
        <div class="update-item">
          <span class="update-item__label">Python 解释器</span>
          <span class="update-value">{{ pythonExists ? '已找到' : '未找到' }}</span>
        </div>
        <div class="update-item">
          <span class="update-item__label">可升级依赖</span>
          <span class="update-value">{{ hasUpgrades ? upgrades.length : 0 }} 个</span>
        </div>
      </div>
    </div>

    <!-- 已安装包列表 -->
    <div class="update-card venv-card">
      <div class="update-card__head-row">
        <h3 class="update-card__title" style="margin: 0">
          <span class="msr" aria-hidden="true">inventory_2</span>
          已安装依赖
        </h3>
        <button
          v-if="hasUpgrades"
          class="btn btn--filled state-layer"
          type="button"
          :disabled="upgradingAll"
          @click="upgradeAll"
        >
          <span class="msr btn__icon" aria-hidden="true">system_update</span>
          {{ upgradingAll ? '升级中…' : `升级全部 (${upgrades.length})` }}
        </button>
      </div>

      <div v-if="loading" class="venv-placeholder">
        <span class="msr venv-placeholder__icon spinning" aria-hidden="true"
          >progress_activity</span
        >
        <span>加载虚拟环境信息...</span>
      </div>

      <div v-else-if="!venvValid" class="venv-empty">
        <span class="msr venv-empty__icon" aria-hidden="true">warning</span>
        <h3 class="venv-empty__title">虚拟环境尚未创建</h3>
        <p class="venv-empty__desc">
          未找到虚拟环境中的 Python 解释器。请先启动主程序或运行
          <code>uv sync</code> 同步依赖后再管理包。
        </p>
      </div>

      <div v-else-if="packages.length === 0" class="venv-empty">
        <span class="msr venv-empty__icon" aria-hidden="true">inbox</span>
        <h3 class="venv-empty__title">虚拟环境为空</h3>
        <p class="venv-empty__desc">环境中尚未安装任何包，点击「安装依赖」添加。</p>
      </div>

      <div v-else class="venv-scroll">
        <ul class="version-list">
          <li
            v-for="pkg in packages"
            :key="pkg.name"
            class="version-item"
            :class="{ 'version-item--upgradable': isUpgradable(pkg.name) }"
          >
            <div class="version-item__info">
              <span class="version-item__tag">
                {{ packageLabel(pkg.name) }}
                <span v-if="isUpgradable(pkg.name)" class="version-item__prerelease">可升级</span>
              </span>
              <span class="venv-package__meta">
                <code class="venv-package__version">v{{ pkg.version }}</code>
                <span v-if="isUpgradable(pkg.name)" class="venv-package__latest">
                  → {{ latestOf(pkg.name) }}
                </span>
              </span>
            </div>
            <div class="venv-package__actions">
              <button
                class="btn btn--tonal btn--small state-layer"
                type="button"
                :disabled="!isUpgradable(pkg.name) || upgrading !== null || refreshing"
                :title="
                  isUpgradable(pkg.name) ? `升级到 ${latestOf(pkg.name)}` : '当前已是最新版本'
                "
                @click="upgrade(pkg.name)"
              >
                <span class="msr btn__icon" aria-hidden="true">system_update</span>
                {{ upgrading === pkg.name ? '升级中…' : '升级' }}
              </button>
              <button
                class="btn btn--danger btn--small state-layer"
                type="button"
                :disabled="uninstalling !== null || refreshing"
                @click="uninstall(pkg.name)"
              >
                <span class="msr btn__icon" aria-hidden="true">delete</span>
                {{ uninstalling === pkg.name ? '卸载中…' : '卸载' }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- 安装依赖弹窗：先搜索包名 → 以版本列表展示 → 每个版本直接安装 -->
    <BaseDialog
      :open="installOpen"
      title="安装依赖"
      :width="480"
      :dismissible="installingVersion === null"
      @close="closeInstallDialog"
    >
      <form class="install-form" @submit.prevent="searchVersions">
        <div class="install-name-row">
          <label class="field field--grow">
            <input
              v-model="installName"
              class="field__input"
              type="text"
              placeholder=" "
              :disabled="installQuerying || installingVersion !== null"
              @input="onNameInput"
            />
            <span class="field__label">包名</span>
          </label>
          <button
            class="btn btn--tonal state-layer"
            type="button"
            :disabled="installQuerying || installingVersion !== null || !installName.trim()"
            @click="searchVersions"
          >
            <span class="msr btn__icon" aria-hidden="true">search</span>
            {{ installQuerying ? '查询中…' : '搜索版本' }}
          </button>
        </div>
        <Transition name="field-error" mode="out-in">
          <p v-if="installError" key="error" class="field__support field__support--error">
            {{ installError }}
          </p>
          <p v-else-if="!installSearched" key="hint" class="field__support">
            输入包名后点击「搜索版本」，再从下方版本列表中选择要安装的版本。
          </p>
          <p v-else-if="installVersions.length === 0" key="empty" class="field__support">
            未找到该包的可用版本。
          </p>
        </Transition>
        <!-- 搜索结果：参照更新面板的版本列表，每个版本行直接提供安装按钮 -->
        <div v-if="installSearched && installVersions.length > 0" class="form-group">
          <div class="install-versions__head">
            <span class="install-versions__count">可用版本 ({{ installVersions.length }})</span>
          </div>
          <div class="install-versions__scroll">
            <ul class="version-list">
              <li
                v-for="(v, index) in installVersions"
                :key="v"
                class="version-item"
                :class="{ 'version-item--current': v === installedVersionOfSearched }"
              >
                <div class="version-item__info">
                  <span class="version-item__tag">
                    <code class="version-item__hash">{{ v }}</code>
                    <span
                      v-if="v === installedVersionOfSearched"
                      class="version-item__current-badge"
                      >已安装</span
                    >
                    <span v-else-if="index === 0" class="version-item__current-badge">最新</span>
                  </span>
                </div>
                <button
                  class="btn btn--tonal btn--small state-layer"
                  type="button"
                  :disabled="installingVersion !== null || v === installedVersionOfSearched"
                  @click="installPackage(installName.trim(), v)"
                >
                  <span
                    v-if="installingVersion === v"
                    class="msr btn__icon spinning"
                    aria-hidden="true"
                    >progress_activity</span
                  >
                  {{
                    v === installedVersionOfSearched
                      ? '当前版本'
                      : installingVersion === v
                        ? '安装中…'
                        : '安装'
                  }}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </form>
      <template #actions>
        <button
          class="btn btn--text state-layer"
          type="button"
          :disabled="installingVersion !== null"
          @click="closeInstallDialog"
        >
          关闭
        </button>
      </template>
    </BaseDialog>

    <!-- 升级依赖进行中的进度覆盖层 -->
    <Transition name="progress-fade">
      <div v-if="upgradeBusy" class="venv-progress" role="status">
        <div class="venv-progress__card">
          <div class="venv-progress__icon">
            <span class="msr spinning" aria-hidden="true">sync</span>
          </div>
          <span class="venv-progress__message">{{ venvProgress?.message ?? '升级依赖中...' }}</span>
          <div class="venv-progress__track">
            <div
              class="venv-progress__bar"
              :style="{
                width:
                  venvProgress && venvProgress.percent >= 0
                    ? `${venvProgress.percent * 100}%`
                    : '40%',
              }"
            ></div>
          </div>
        </div>
      </div>
    </Transition>

    <ErrorDialog
      :open="errorDialog !== null"
      :title="errorDialog?.title ?? '操作失败'"
      :description="errorDialog?.description ?? '操作失败，请稍后重试'"
      @close="errorDialog = null"
    />
  </div>
</template>

<style scoped>
.venv-view {
  max-width: 1120px;
  height: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
}

.update-toolbar,
.update-card {
  padding: 20px 24px;
  border: 1px solid var(--app-glass-border);
  border-radius: 20px;
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.update-toolbar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.update-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.update-head__info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.venv-head__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.update-head__icon {
  font-size: 32px;
  color: var(--md-sys-color-primary);
}

.update-head__title {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
}

.update-head__badge {
  display: inline-block;
  max-width: 320px;
  padding: 2px 12px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-head__badge--ok {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.update-head__badge--warn {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.venv-head__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.venv-overview {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.update-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.update-item__label {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
}

.update-value {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
}

.update-value--mono {
  font-family: var(--md-ref-typeface-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.venv-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.update-card__head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.update-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font: var(--md-sys-typescale-title-medium);
  color: var(--md-sys-color-on-surface);
}

.update-card__title .msr {
  font-size: 20px;
  color: var(--md-sys-color-primary);
}

.venv-placeholder,
.venv-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
}

.venv-placeholder__icon,
.venv-empty__icon {
  font-size: 40px;
  color: var(--md-sys-color-on-surface-variant);
}

.venv-empty__title {
  margin: 0;
  font: var(--md-sys-typescale-title-medium);
  color: var(--md-sys-color-on-surface);
}

.venv-empty__desc {
  margin: 0;
  max-width: 420px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.venv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.version-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-low);
}

.version-item--upgradable {
  border-color: color-mix(in srgb, var(--md-sys-color-tertiary) 55%, transparent);
  background: var(--md-sys-color-tertiary-container);
}

.version-item--current {
  border-color: var(--md-sys-color-primary);
  background: color-mix(in srgb, var(--md-sys-color-primary-container) 60%, transparent);
}

.version-item__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.version-item__tag {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-small);
}

.version-item__prerelease {
  padding: 1px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-tertiary) 22%, transparent);
  color: var(--md-sys-color-on-tertiary-container);
  font: var(--md-sys-typescale-label-small);
}

.venv-package__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.venv-package__version {
  font-family: var(--md-ref-typeface-mono);
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}

.venv-package__latest {
  font-size: 12px;
  font-weight: 600;
  color: var(--md-sys-color-tertiary);
}

.venv-package__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.install-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.install-name-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.install-name-row .btn {
  flex: none;
  margin-top: 8px;
  height: 40px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.install-versions__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.install-versions__count {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
}

.install-versions__scroll {
  max-height: 300px;
  overflow-y: auto;
  padding-right: 2px;
}

.install-versions__scroll .version-list {
  gap: 8px;
}

.version-item__hash {
  font-family: var(--md-ref-typeface-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--md-sys-color-primary);
}

.version-item__current-badge {
  padding: 1px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font: var(--md-sys-typescale-label-small);
}

.field__support {
  margin: 4px 0 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.field__support--error {
  margin-left: 0;
  padding: 8px 12px;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font-weight: 600;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.btn__icon {
  font-size: 18px;
}

.btn--small {
  height: 32px;
  padding: 0 14px;
  font-size: 13px;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--tonal {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.btn--danger {
  background: color-mix(in srgb, var(--md-sys-color-error) 12%, transparent);
  color: var(--md-sys-color-error);
}

.btn--text {
  padding: 0 12px;
  background: transparent;
  color: var(--md-sys-color-primary);
}

.spinning {
  animation: venv-spin 1s linear infinite;
}

@keyframes venv-spin {
  to {
    transform: rotate(360deg);
  }
}

.field-error-enter-active,
.field-error-leave-active {
  transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized);
}

.field-error-enter-from,
.field-error-leave-to {
  opacity: 0;
}

/* 升级依赖进度覆盖层 */
.venv-progress {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);
}

.venv-progress__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: min(420px, calc(100% - 64px));
  padding: 28px 32px;
  border-radius: 24px;
  background: var(--md-sys-color-surface-container-high);
  box-shadow: var(--md-sys-elevation-level3);
  color: var(--md-sys-color-on-surface);
}

.venv-progress__icon {
  color: var(--md-sys-color-primary);
  font-size: 32px;
}

.venv-progress__message {
  font: var(--md-sys-typescale-body-medium);
  text-align: center;
}

.venv-progress__track {
  width: 100%;
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  overflow: hidden;
}

.venv-progress__bar {
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  transition: width var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

.progress-fade-enter-active,
.progress-fade-leave-active {
  transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.progress-fade-enter-from,
.progress-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
