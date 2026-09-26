<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { renderRemoteMarkdown, normalizeHttpsUrl } from '@/utils/remote-markdown';
import type { Instance } from '@shared/domain/instance';
import type { VenvInfo, VenvPackageInfo, VenvProgressEvent } from '@shared/domain/venv';
import { MofoxError } from '@shared/domain/error';
import { mofoxApi } from '@/services/mofox-api';
import { useToast } from '@/composables/use-toast';
import BaseDialog from '@/components/ui/BaseDialog.vue';
import ErrorDialog from '@/components/ui/ErrorDialog.vue';

// 虚拟环境面板：展示实例 venv 目录下的包列表与可升级依赖，
// 支持安装、卸载与升级单个包，并提供「升级全部」与镜像轮询安装。
// 安装必须先搜索包名，搜索后按版本逐条展示并直接安装到指定版本；
// 升级依赖期间通过 venv-progress 事件驱动进度弹窗。
const props = defineProps<{
  instance: Instance;
}>();

const { show: showToast } = useToast();

const info = ref<VenvInfo | null>(null);
const loading = ref(false);
const refreshing = ref(false);

const uninstalling = ref<string | null>(null);
const upgrading = ref<string | null>(null);
const upgradingAll = ref(false);

// 包信息弹窗：从已安装包列表进入，展示简介/描述并提供 PyPI 跳转。
const packageInfoOpen = ref(false);
const packageInfo = ref<VenvPackageInfo | null>(null);
const packageInfoLoading = ref(false);
const packageInfoError = ref('');
const packageInfoName = ref('');

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

// 概览指标：加载中与不可用环境分别给出占位展示，避免加载期间误报“未找到”。
const pythonText = computed(() => (loading.value ? '…' : pythonExists.value ? '已找到' : '未找到'));
const pythonWarn = computed(() => !loading.value && !pythonExists.value);

const installedCountText = computed(() => {
  if (loading.value) return '…';
  return venvValid.value ? `${packages.value.length} 个` : '—';
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
    showToast(`虚拟环境信息加载失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    loading.value = false;
  }
}

async function refresh(): Promise<void> {
  refreshing.value = true;
  try {
    info.value = await mofoxApi.getVenvInfo(props.instance.id);
  } catch (error) {
    showToast(`刷新失败: ${error instanceof Error ? error.message : String(error)}`);
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
    showToast(`已安装 ${name} ${version}`);
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
    installError.value = describeVenvError(error, '查询版本失败');
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
    showToast(`已卸载 ${name}`);
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
    showToast(`已升级 ${name}`);
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
    showToast('已升级全部可升级依赖');
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

/** 展示 venv 操作错误：未找到包时直接给出提示，其余错误附带操作前缀。 */
function describeVenvError(error: unknown, prefix: string): string {
  if (error instanceof MofoxError && error.code === 'NOT_FOUND') return error.message;
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}

/** 打开指定已安装包的详情弹窗并抓取介绍信息。 */
async function showPackageInfo(name: string): Promise<void> {
  packageInfoName.value = name;
  packageInfo.value = null;
  packageInfoError.value = '';
  packageInfoOpen.value = true;
  packageInfoLoading.value = true;
  try {
    packageInfo.value = await mofoxApi.getVenvPackageInfo(props.instance.id, name);
  } catch (error) {
    packageInfoError.value = describeVenvError(error, '获取包信息失败');
  } finally {
    packageInfoLoading.value = false;
  }
}

/** 将包的长描述以 Markdown 渲染为 HTML。 */
const packageInfoHtml = computed(() =>
  packageInfo.value?.description ? renderRemoteMarkdown(packageInfo.value.description) : '',
);

function closePackageInfo(): void {
  packageInfoOpen.value = false;
}

/** 在系统浏览器打开 PyPI 项目页。 */
function openPypi(): void {
  const url = packageInfo.value?.pypiUrl;
  if (url) void mofoxApi.openExternal(url);
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
function openDescriptionLink(event: MouseEvent): void {
  const anchor = event.target instanceof window.Element ? event.target.closest('a') : null;
  if (!(anchor instanceof window.HTMLAnchorElement)) return;
  event.preventDefault();
  const url = normalizeHttpsUrl(anchor.href);
  if (url) void mofoxApi.openExternal(url);
}
</script>

<template>
  <section class="manage-group">
    <div class="manage-group__card">
      <!-- 卡片头部：分区图标 + 标题描述 + 刷新 / 安装依赖 -->
      <div class="manage-group__heading">
        <span class="msr" aria-hidden="true">science</span>
        <div>
          <h2>虚拟环境</h2>
          <p>Python 环境与依赖包管理</p>
        </div>
        <div class="venv-heading__actions">
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

      <div class="manage-group__body">
        <!-- 环境概览：与信息查看面板 info-grid 同构的迷你指标块 -->
        <div class="venv-overview">
          <div class="venv-overview__item">
            <span class="venv-overview__label">环境路径</span>
            <span
              class="venv-overview__value venv-overview__value--mono"
              :title="instance.venvDir || '—'"
              >{{ instance.venvDir || '—' }}</span
            >
          </div>
          <div class="venv-overview__item">
            <span class="venv-overview__label">Python 解释器</span>
            <span
              class="venv-overview__value"
              :class="{ 'venv-overview__value--warn': pythonWarn }"
            >
              {{ pythonText }}
            </span>
          </div>
          <div class="venv-overview__item">
            <span class="venv-overview__label">已安装依赖</span>
            <span class="venv-overview__value">{{ installedCountText }}</span>
          </div>
          <div class="venv-overview__item">
            <span class="venv-overview__label">可升级依赖</span>
            <span
              class="venv-overview__value"
              :class="{ 'venv-overview__value--accent': hasUpgrades }"
            >
              {{ upgrades.length }} 个
            </span>
          </div>
        </div>

        <!-- 已安装包列表 -->
        <div class="venv-list-card">
          <div class="update-card__head-row">
            <h3 class="update-card__title">
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
                    <span v-if="isUpgradable(pkg.name)" class="version-item__prerelease"
                      >可升级</span
                    >
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
                    title="查看包信息"
                    :disabled="refreshing"
                    @click="showPackageInfo(pkg.name)"
                  >
                    <span class="msr btn__icon" aria-hidden="true">info</span>
                    信息
                  </button>
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

    <!-- 包信息弹窗：简介/描述 + PyPI 跳转 -->
    <BaseDialog
      :open="packageInfoOpen"
      :title="`${packageInfo?.name ?? packageInfoName} 信息`"
      :width="520"
      :dismissible="true"
      @close="closePackageInfo"
    >
      <div v-if="packageInfoLoading" class="pkginfo-placeholder">
        <span class="msr pkginfo-placeholder__icon spinning" aria-hidden="true"
          >progress_activity</span
        >
        <span>正在获取包信息...</span>
      </div>
      <div v-else-if="packageInfoError" class="pkginfo-error">
        <span class="msr" aria-hidden="true">error</span>
        <span>{{ packageInfoError }}</span>
      </div>
      <div v-else-if="packageInfo" class="pkginfo">
        <div class="pkginfo__row">
          <span class="pkginfo__label">版本</span>
          <span class="pkginfo__value pkginfo__value--mono">{{ packageInfo.version || '—' }}</span>
        </div>
        <div v-if="packageInfo.summary" class="pkginfo__row">
          <span class="pkginfo__label">简介</span>
          <span class="pkginfo__value">{{ packageInfo.summary }}</span>
        </div>
        <div v-if="packageInfo.author" class="pkginfo__row">
          <span class="pkginfo__label">作者</span>
          <span class="pkginfo__value">{{ packageInfo.author }}</span>
        </div>
        <div v-if="packageInfo.requiresPython" class="pkginfo__row">
          <span class="pkginfo__label">Python 版本</span>
          <span class="pkginfo__value pkginfo__value--mono">{{ packageInfo.requiresPython }}</span>
        </div>
        <div v-if="packageInfo.description" class="pkginfo__row">
          <span class="pkginfo__label">介绍</span>
          <!-- 长描述为不可信网络内容，仅渲染为展示文本，不暴露脚本能力。 -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="pkginfo__desc" v-html="packageInfoHtml" @click="openDescriptionLink"></div>
        </div>
        <div
          v-if="Object.keys(packageInfo.projectUrls).length > 0 || packageInfo.homePage"
          class="pkginfo__row"
        >
          <span class="pkginfo__label">相关链接</span>
          <div class="pkginfo__links">
            <button
              v-if="packageInfo.homePage"
              class="btn btn--tonal btn--small state-layer"
              type="button"
              @click="mofoxApi.openExternal(packageInfo.homePage)"
            >
              <span class="msr btn__icon" aria-hidden="true">home</span>
              主页
            </button>
            <button
              v-for="(url, label) in packageInfo.projectUrls"
              :key="label"
              class="btn btn--tonal btn--small state-layer"
              type="button"
              @click="mofoxApi.openExternal(url)"
            >
              <span class="msr btn__icon" aria-hidden="true">link</span>
              {{ label }}
            </button>
          </div>
        </div>
      </div>
      <template #actions>
        <button class="btn btn--text state-layer" type="button" @click="closePackageInfo">
          关闭
        </button>
        <button
          class="btn btn--filled state-layer"
          type="button"
          :disabled="!packageInfo"
          @click="openPypi"
        >
          <span class="msr btn__icon" aria-hidden="true">open_in_new</span>
          在 PyPI 查看
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
  </section>
</template>

<style scoped src="./InstanceVenvPanel.css"></style>
