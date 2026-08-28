<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Instance } from '@shared/domain/instance';
import type { SystemEnvInfo } from '@shared/domain/system-env';
import type {
  MofoxUpdateInfo,
  PlatformUpdateInfo,
  UpdateProgressEvent,
} from '@shared/domain/update';
import { mofoxApi } from '@/services/mofox-api';
import ErrorDialog from '@/components/ErrorDialog.vue';

// 更新面板：参照旧启动器「版本管理」，顶部切换主程序 / 平台两个更新目标。
// 主程序采用左右双栏：左侧为版本信息 + 分支切换，右侧为检查更新 + 提交历史。
// 页面固定高度不整体滚动，只有提交历史 / 可用版本列表在内部滚动。
type UpdateTarget = 'mofox' | 'platform';

const props = defineProps<{
  instance: Instance;
}>();

const emit = defineEmits<{
  toast: [message: string];
}>();

// 更新失败时弹出的应用内错误框；`stack` 可选，仅 Error 实例携带。
interface UpdateErrorState {
  title: string;
  description: string;
  stack?: string;
}

const MOFOX_REPOSITORY_URL = 'https://github.com/MoFox-Studio/Neo-MoFox';

const errorDialog = ref<UpdateErrorState | null>(null);

// 打开错误弹窗；空标题按“更新失败”兜底，非 Error 值字符串化后展示。
function showUpdateError(title: string, error: unknown): void {
  errorDialog.value = {
    title: title || '更新失败',
    description: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  };
}

function openRepository(): void {
  void mofoxApi.openExternal(MOFOX_REPOSITORY_URL);
}

const target = ref<UpdateTarget>('mofox');
const mofoxInfo = ref<MofoxUpdateInfo | null>(null);
const platformInfo = ref<PlatformUpdateInfo | null>(null);
const loadingMofox = ref(false);
const loadingPlatform = ref(false);
const switchingBranch = ref(false);
const checkingOut = ref(false);
const updatingMofox = ref(false);
const updatingPlatform = ref(false);
const selectedBranch = ref('');
const env = ref<SystemEnvInfo | null>(null);

// 最新进度消息：任何进行中的更新操作都驱动顶部进度条。
const progress = ref<UpdateProgressEvent | null>(null);
const busy = computed(() => progress.value !== null);

let unsubscribeProgress: (() => void) | null = null;

const mofoxBranches = computed(() => mofoxInfo.value?.branches ?? []);
const mofoxCommits = computed(() => mofoxInfo.value?.commits ?? []);
const hasMofoxUpdate = computed(() => mofoxInfo.value?.hasUpdate ?? false);

const releases = computed(() => platformInfo.value?.releases ?? []);
const platformInstalled = computed(() => platformInfo.value?.installed ?? false);
const platformCurrentVersion = computed(() => platformInfo.value?.currentVersion ?? null);

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function refreshMofox(): Promise<void> {
  loadingMofox.value = true;
  try {
    mofoxInfo.value = await mofoxApi.getMofoxUpdateInfo(props.instance.id);
    if (!selectedBranch.value && mofoxInfo.value.branch) {
      selectedBranch.value = mofoxInfo.value.branch;
    }
  } catch (error) {
    emit(
      'toast',
      `主程序版本信息加载失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    loadingMofox.value = false;
  }
}

async function refreshPlatform(): Promise<void> {
  loadingPlatform.value = true;
  try {
    platformInfo.value = await mofoxApi.getPlatformUpdateInfo(props.instance.id);
  } catch (error) {
    emit(
      'toast',
      `平台版本信息加载失败: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    loadingPlatform.value = false;
  }
}

async function refresh(): Promise<void> {
  await Promise.all([refreshMofox(), refreshPlatform()]);
}

function onBranchChange(event: Event): void {
  selectedBranch.value = (event.target as HTMLSelectElement).value;
}

async function doSwitchBranch(): Promise<void> {
  if (switchingBranch.value || !selectedBranch.value) return;
  switchingBranch.value = true;
  try {
    mofoxInfo.value = await mofoxApi.switchMofoxBranch(props.instance.id, selectedBranch.value);
    emit('toast', `已切换到分支 ${selectedBranch.value}`);
  } catch (error) {
    showUpdateError('分支切换失败', error);
  } finally {
    switchingBranch.value = false;
  }
}

async function doCheckout(commitHash: string): Promise<void> {
  if (checkingOut.value) return;
  checkingOut.value = true;
  try {
    mofoxInfo.value = await mofoxApi.checkoutMofoxCommit(props.instance.id, commitHash);
    emit('toast', `已回退到提交 ${commitHash}`);
  } catch (error) {
    showUpdateError('回退失败', error);
  } finally {
    checkingOut.value = false;
  }
}

async function doUpdateMofox(): Promise<void> {
  if (updatingMofox.value) return;
  updatingMofox.value = true;
  try {
    mofoxInfo.value = await mofoxApi.updateMofox(props.instance.id);
    emit('toast', '主程序已更新到最新提交');
  } catch (error) {
    showUpdateError('主程序更新失败', error);
  } finally {
    updatingMofox.value = false;
  }
}

async function doUpdatePlatform(version: string): Promise<void> {
  if (updatingPlatform.value) return;
  updatingPlatform.value = true;
  try {
    platformInfo.value = await mofoxApi.updatePlatform(props.instance.id, version);
    emit('toast', version ? `平台已更改到 ${version}` : '平台已更新到最新版本');
  } catch (error) {
    showUpdateError('平台更新失败', error);
  } finally {
    updatingPlatform.value = false;
  }
}

onMounted(() => {
  void refresh();
  // 探测更新依赖（git / uv / python）版本，用于更新页诊断展示。
  void mofoxApi
    .detectSystemEnv()
    .then((value) => {
      env.value = value;
    })
    .catch(() => undefined);
  // 只接收当前实例的更新进度，驱动顶部进度条与操作中的提示文本。
  unsubscribeProgress = mofoxApi.on('update-progress', (event) => {
    if (event.instanceId !== props.instance.id) return;
    if (event.error) {
      progress.value = null;
      showUpdateError('更新失败', new Error(event.error));
      return;
    }
    if (event.percent >= 1) {
      progress.value = null;
      return;
    }
    progress.value = event;
  });
});

onBeforeUnmount(() => {
  unsubscribeProgress?.();
});
</script>

<template>
  <section class="update-view">
    <!-- 顶部工具条：标题与更新目标切换共用同一玻璃背景 -->
    <div class="update-toolbar">
      <!-- 头部：返回主界面操作与实例名徽标 -->
      <div class="update-head">
        <div class="update-head__info">
          <span class="msr update-head__icon" aria-hidden="true">system_update</span>
          <div>
            <h2 class="update-head__title">版本管理</h2>
            <span class="update-head__badge">{{ instance.name }}</span>
          </div>
        </div>
        <button
          class="icon-btn state-layer"
          type="button"
          title="刷新版本信息"
          aria-label="刷新版本信息"
          @click="refresh"
        >
          <span class="msr" aria-hidden="true">refresh</span>
        </button>
      </div>

      <!-- 顶部切换：Neo-MoFox / 平台 -->
      <div class="update-targets" role="tablist" aria-label="更新目标">
        <button
          class="update-target state-layer"
          :class="{ 'update-target--active': target === 'mofox' }"
          type="button"
          role="tab"
          :aria-selected="target === 'mofox'"
          @click="target = 'mofox'"
        >
          <span class="msr" aria-hidden="true">smart_toy</span>
          Neo-MoFox
        </button>
        <button
          class="update-target state-layer"
          :class="{ 'update-target--active': target === 'platform' }"
          type="button"
          role="tab"
          :aria-selected="target === 'platform'"
          @click="target = 'platform'"
        >
          <span class="msr" aria-hidden="true">terminal</span>
          平台
        </button>
      </div>
    </div>

    <!-- ─── 主程序更新：左侧版本信息 + 分支切换，右侧检查更新 + 提交历史 ─── -->
    <div v-if="target === 'mofox'" class="update-two-col">
      <div class="update-panel update-panel--left">
        <!-- 版本信息卡片：双栏展示当前版本信息与提交信息 -->
        <div class="update-card info-card-split">
          <div class="info-split-col">
            <h3 class="update-card__title">
              <span class="msr" aria-hidden="true">info</span>
              当前版本信息
            </h3>
            <div class="update-item">
              <span class="update-item__label">当前分支</span>
              <span class="update-badge">{{ mofoxInfo?.branch ?? '—' }}</span>
            </div>
            <div class="update-item">
              <span class="update-item__label">当前版本</span>
              <span class="update-value update-value--mono">{{
                mofoxInfo?.currentCommit?.hash ?? '—'
              }}</span>
            </div>
          </div>
          <div class="info-split-col">
            <h3 class="update-card__title">
              <span class="msr" aria-hidden="true">update</span>
              提交信息
            </h3>
            <div class="update-item">
              <span class="update-item__label">最新提交</span>
              <div class="commit-box">
                <code class="commit-box__hash">{{ mofoxInfo?.currentCommit?.hash ?? '—' }}</code>
                <span class="commit-box__message">{{
                  mofoxInfo?.currentCommit?.message || '—'
                }}</span>
              </div>
            </div>
            <div class="update-item">
              <span class="update-item__label">提交时间</span>
              <span class="update-value">{{ formatDate(mofoxInfo?.currentCommit?.date) }}</span>
            </div>
          </div>
        </div>

        <!-- 分支切换 -->
        <div class="update-card">
          <h3 class="update-card__title">
            <span class="msr" aria-hidden="true">account_tree</span>
            分支切换
          </h3>
          <div class="update-control-row">
            <md-outlined-select
              class="update-select"
              label="选择分支"
              :value="selectedBranch"
              :disabled="loadingMofox || switchingBranch || busy"
              @change="onBranchChange"
            >
              <!-- Material Web Components 使用原生具名插槽，而不是 Vue 模板插槽。 -->
              <!-- eslint-disable vue/no-deprecated-slot-attribute -->
              <md-select-option v-for="branch in mofoxBranches" :key="branch" :value="branch">
                <div slot="headline">{{ branch }}</div>
              </md-select-option>
              <!-- eslint-enable vue/no-deprecated-slot-attribute -->
            </md-outlined-select>
            <button
              class="btn btn--filled state-layer"
              type="button"
              :disabled="!selectedBranch || switchingBranch || busy"
              @click="doSwitchBranch"
            >
              <span class="msr btn__icon" aria-hidden="true">swap_horiz</span>
              {{ switchingBranch ? '切换中…' : '切换' }}
            </button>
          </div>
          <p class="update-hint">注意：切换分支将会暂存本地更改并拉取最新代码。</p>
        </div>

        <!-- 仓库状态：填充左栏剩余高度 -->
        <div class="update-card update-fill-card">
          <h3 class="update-card__title">
            <span class="msr" aria-hidden="true">analytics</span>
            仓库状态
          </h3>
          <div class="update-item">
            <span class="update-item__label">本地进度</span>
            <span class="update-value">
              <span class="count-chip">领先 {{ mofoxInfo?.aheadCount ?? 0 }}</span>
              <span class="count-chip">落后 {{ mofoxInfo?.behindCount ?? 0 }}</span>
            </span>
          </div>
          <div class="update-item">
            <span class="update-item__label">远程分支</span>
            <span class="update-value">{{ mofoxInfo?.branches?.length ?? 0 }} 个可用分支</span>
          </div>
          <div class="update-item">
            <span class="update-item__label">更新依赖</span>
            <div class="dep-list">
              <span class="dep-item">
                <span class="msr" aria-hidden="true">code</span>
                <span>Git</span>
                <code>{{ env?.gitVersion || '—' }}</code>
              </span>
              <span class="dep-item">
                <span class="msr" aria-hidden="true">terminal</span>
                <span>uv</span>
                <code>{{ env?.uvVersion || '—' }}</code>
              </span>
              <span class="dep-item">
                <span class="msr" aria-hidden="true">science</span>
                <span>Python</span>
                <code>{{ env?.pythonVersion || '—' }}</code>
              </span>
            </div>
          </div>
          <div class="update-repo-row">
            <span class="msr" aria-hidden="true">link</span>
            <span class="update-repo-row__text">MoFox-Studio/Neo-MoFox</span>
            <button
              class="btn btn--tonal btn--small state-layer"
              type="button"
              @click="openRepository"
            >
              <span class="msr btn__icon" aria-hidden="true">open_in_new</span>
              打开仓库
            </button>
          </div>
        </div>
      </div>

      <div class="update-panel update-panel--right">
        <!-- 检查更新 -->
        <div class="update-card">
          <h3 class="update-card__title">
            <span class="msr" aria-hidden="true">system_update</span>
            检查更新
          </h3>
          <div class="update-status" :class="{ 'update-status--ok': hasMofoxUpdate }">
            <span class="msr" :class="{ spinning: loadingMofox }" aria-hidden="true">
              {{
                loadingMofox
                  ? 'progress_activity'
                  : hasMofoxUpdate
                    ? 'system_update'
                    : 'check_circle'
              }}
            </span>
            <span class="update-status__text">
              {{
                loadingMofox
                  ? '正在检查更新...'
                  : hasMofoxUpdate
                    ? `发现 ${mofoxInfo?.behindCount ?? 0} 个新提交`
                    : '已是最新版本'
              }}
            </span>
          </div>
          <button
            class="btn btn--tonal update-full"
            type="button"
            :disabled="!mofoxInfo?.isRepository || updatingMofox || busy"
            @click="doUpdateMofox"
          >
            <span class="msr btn__icon" aria-hidden="true">download</span>
            {{ updatingMofox ? '更新中…' : '检查并更新' }}
          </button>
        </div>

        <!-- 提交历史：独占剩余高度，内部滚动 -->
        <div class="update-card update-scroll-card">
          <h3 class="update-card__title">
            <span class="msr" aria-hidden="true">history</span>
            提交历史
          </h3>
          <div v-if="loadingMofox" class="update-placeholder">
            <span class="msr update-placeholder__icon spinning" aria-hidden="true"
              >progress_activity</span
            >
            <span>加载提交历史...</span>
          </div>
          <div v-else-if="mofoxCommits.length === 0" class="update-placeholder">
            <span>暂无提交记录</span>
          </div>
          <div v-else class="update-scroll">
            <ul class="version-list">
              <li
                v-for="commit in mofoxCommits"
                :key="commit.fullHash"
                class="version-item"
                :class="{ 'version-item--current': commit.isCurrent }"
              >
                <div class="version-item__info">
                  <span class="version-item__tag">
                    <code class="version-item__hash">{{ commit.hash }}</code>
                    <span v-if="commit.isCurrent" class="version-item__current-badge">当前</span>
                  </span>
                  <span class="version-item__message">{{ commit.message }}</span>
                  <span class="version-item__date">{{ formatDate(commit.date) }}</span>
                </div>
                <button
                  class="btn btn--tonal btn--small state-layer"
                  type="button"
                  :disabled="commit.isCurrent || checkingOut || busy"
                  @click="doCheckout(commit.hash)"
                >
                  {{ commit.isCurrent ? '当前版本' : checkingOut ? '回退中…' : '回退' }}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── 平台更新 ─── -->
    <div v-else class="update-platform">
      <template v-if="platformInstalled">
        <div class="update-card">
          <h3 class="update-card__title">
            <span class="msr" aria-hidden="true">info</span>
            当前平台版本信息
          </h3>
          <div class="update-item">
            <span class="update-item__label">当前版本</span>
            <span class="update-badge update-badge--success">{{
              platformCurrentVersion ?? '未知'
            }}</span>
          </div>
          <div class="update-item">
            <span class="update-item__label">安装路径</span>
            <span class="update-value update-value--mono">{{
              instance.platform?.installDir || '—'
            }}</span>
          </div>
        </div>

        <!-- 可用版本列表：更新按钮在列表上方，列表内部滚动 -->
        <div class="update-card update-scroll-card">
          <div class="update-card__head-row">
            <h3 class="update-card__title" style="margin: 0">
              <span class="msr" aria-hidden="true">history</span>
              可用版本列表
            </h3>
            <button
              class="btn btn--filled state-layer"
              type="button"
              :disabled="updatingPlatform || busy"
              @click="doUpdatePlatform('')"
            >
              <span class="msr btn__icon" aria-hidden="true">download</span>
              {{ updatingPlatform ? '更新中…' : '更新到最新' }}
            </button>
          </div>
          <div v-if="loadingPlatform" class="update-placeholder">
            <span class="msr update-placeholder__icon spinning" aria-hidden="true"
              >progress_activity</span
            >
            <span>加载版本列表...</span>
          </div>
          <div v-else class="update-scroll">
            <ul class="version-list">
              <li
                v-for="release in releases"
                :key="release.tag_name"
                class="version-item"
                :class="{ 'version-item--current': release.tag_name === platformCurrentVersion }"
              >
                <div class="version-item__info">
                  <span class="version-item__tag">
                    {{ release.tag_name }}
                    <span v-if="release.prerelease" class="version-item__prerelease">预发布</span>
                  </span>
                  <span class="version-item__date">{{ formatDate(release.published_at) }}</span>
                </div>
                <button
                  class="btn btn--tonal btn--small state-layer"
                  type="button"
                  :disabled="
                    updatingPlatform || busy || release.tag_name === platformCurrentVersion
                  "
                  @click="doUpdatePlatform(release.tag_name)"
                >
                  {{
                    release.tag_name === platformCurrentVersion
                      ? '当前版本'
                      : updatingPlatform
                        ? '更改中…'
                        : '更改到此版本'
                  }}
                </button>
              </li>
            </ul>
          </div>
        </div>
      </template>

      <div v-else class="update-empty">
        <span class="msr update-empty__icon" aria-hidden="true">warning</span>
        <h3 class="update-empty__title">平台未安装</h3>
        <p class="update-empty__desc">
          当前实例尚未安装平台组件，请在实例配置中安装平台后再进行版本管理。
        </p>
      </div>
    </div>

    <!-- 更新进行中的进度覆盖层 -->
    <Transition name="progress-fade">
      <div v-if="busy" class="update-progress" role="status">
        <div class="update-progress__card">
          <div class="update-progress__icon">
            <span class="msr spinning" aria-hidden="true">sync</span>
          </div>
          <span class="update-progress__message">{{ progress?.message ?? '处理中...' }}</span>
          <div class="update-progress__track">
            <div
              class="update-progress__bar"
              :style="{
                width: progress && progress.percent >= 0 ? `${progress.percent * 100}%` : '40%',
              }"
            ></div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 更新失败时的应用内错误框 -->
    <ErrorDialog
      :open="errorDialog !== null"
      :title="errorDialog?.title ?? '更新失败'"
      :description="errorDialog?.description ?? '更新失败，请稍后重试'"
      :stack="errorDialog?.stack"
      @close="errorDialog = null"
    />
  </section>
</template>

<style scoped>
/* 固定高度：整体不滚动，只有提交历史 / 版本列表在内部滚动。 */
.update-view {
  width: 100%;
  max-width: 1120px;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
}

/* 顶部工具条：标题与更新目标切换共用同一玻璃背景，与设置页卡片一致。 */
.update-toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 20px;
  border: 1px solid var(--app-glass-border);
  border-radius: 20px;
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
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
  max-width: 260px;
  margin-top: 2px;
  padding: 2px 12px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 顶部切换：Neo-MoFox / 平台 */
.update-targets {
  display: inline-flex;
  gap: 4px;
  align-self: flex-start;
  padding: 4px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-full);
  /* 嵌套在玻璃工具条内使用半透明内嵌面，避免重复模糊造成堆叠。 */
  background: color-mix(in srgb, var(--md-sys-color-surface-container-high) 72%, transparent);
}

.update-target {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.update-target--active {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

/* 主程序：左右双栏等宽等高，整体占满剩余高度 */
.update-two-col {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.update-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

/* 左栏内容超出时仅在内部滚动，避免整页滚动。 */
.update-panel--left {
  overflow-y: auto;
}

/* 右栏禁止整栏滚动，由提交历史卡片内部滚动。 */
.update-panel--right {
  overflow: hidden;
}

/* 平台：整列占满剩余高度 */
.update-platform {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.update-card {
  padding: 20px 24px;
  border: 1px solid var(--app-glass-border);
  border-radius: 20px;
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

/* 版本信息卡片：内部双栏（当前版本信息 | 提交信息） */
.info-card-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.info-split-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.info-split-col + .info-split-col {
  padding-left: 16px;
  border-left: 1px solid var(--md-sys-color-outline-variant);
}

/* 内部滚动的卡片：标题固定，列表区域伸缩并滚动。 */
.update-scroll-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.update-card__head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.update-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font: var(--md-sys-typescale-title-medium);
  color: var(--md-sys-color-on-surface);
}

.update-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.update-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.update-item__label {
  font: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.update-value {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface);
}

.update-value--mono {
  font-family: var(--md-ref-typeface-mono);
  word-break: break-all;
}

.update-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px 14px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-primary) 14%, transparent);
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
}

.update-badge--success {
  background: color-mix(in srgb, var(--md-sys-color-tertiary) 14%, transparent);
  color: var(--md-sys-color-tertiary);
}

/* 最新提交信息框 */
.commit-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-small);
}

.commit-box__hash {
  font-family: var(--md-ref-typeface-mono);
  font-size: 12px;
  color: var(--md-sys-color-primary);
  font-weight: 500;
}

.commit-box__message {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-control-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.update-select {
  flex: 1;
  min-width: 0;
}

.update-hint {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-left: 3px solid var(--md-sys-color-primary);
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

/* 仓库状态卡片：填充左栏剩余高度，仓库行固定在底部。 */
.update-fill-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.count-chip {
  display: inline-flex;
  align-items: center;
  margin-right: 8px;
  padding: 2px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
}

.dep-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dep-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-surface-container-high);
}

.dep-item .msr {
  font-size: 18px;
  color: var(--md-sys-color-primary);
}

.dep-item code {
  margin-left: auto;
  font-family: var(--md-ref-typeface-mono);
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}

.update-repo-row {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.update-repo-row .msr {
  color: var(--md-sys-color-on-surface-variant);
}

.update-repo-row__text {
  flex: 1;
  min-width: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  font-family: var(--md-ref-typeface-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 12px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.update-status--ok {
  color: var(--md-sys-color-tertiary);
}

.update-full {
  width: 100%;
  justify-content: center;
}

.update-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.update-placeholder__icon {
  font-size: 32px;
}

/* 提交历史 / 版本列表（卡片式条目） */
.version-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.version-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-low);
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.version-item--current {
  border-color: var(--md-sys-color-primary);
  background: color-mix(in srgb, var(--md-sys-color-primary-container) 60%, transparent);
}

.version-item__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.version-item__tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-label-large);
}

.version-item__hash {
  font-family: var(--md-ref-typeface-mono);
  font-size: 12px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: var(--md-sys-shape-corner-small);
  background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent);
  color: var(--md-sys-color-primary);
}

.version-item__current-badge {
  padding: 1px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font: var(--md-sys-typescale-label-small);
}

.version-item__message {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-small);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.version-item__date {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.version-item__prerelease {
  padding: 1px 6px;
  border-radius: var(--md-sys-shape-corner-small);
  background: color-mix(in srgb, var(--md-sys-color-error) 14%, transparent);
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-label-small);
}

.update-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
}

.update-empty__icon {
  font-size: 56px;
  color: var(--md-sys-color-on-surface-variant);
}

.update-empty__title {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
}

.update-empty__desc {
  margin: 0;
  max-width: 420px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

/* 更新进度覆盖层 */
.update-progress {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent);
}

.update-progress__card {
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

.update-progress__icon {
  color: var(--md-sys-color-primary);
  font-size: 32px;
}

.spinning {
  animation: update-spin 1s linear infinite;
}

@keyframes update-spin {
  to {
    transform: rotate(360deg);
  }
}

.update-progress__message {
  font: var(--md-sys-typescale-body-medium);
  text-align: center;
}

.update-progress__track {
  width: 100%;
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  overflow: hidden;
}

.update-progress__bar {
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

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  flex-shrink: 0;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.btn--small {
  height: 32px;
  padding: 0 14px;
  font: var(--md-sys-typescale-label-medium);
}

.btn__icon {
  font-size: 18px;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--tonal {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: grid;
  place-items: center;
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
