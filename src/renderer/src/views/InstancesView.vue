<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Instance, InstanceStatus } from '@shared/domain/instance';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import PageHeader from '@/components/PageHeader.vue';
import InstanceCard from '@/components/InstanceCard.vue';
import BaseDialog from '@/components/BaseDialog.vue';

// 实例管理页提供搜索、状态筛选、操作分发及删除确认。
type FilterKey = 'all' | 'running' | 'stopped' | 'error';

interface FilterOption {
  key: FilterKey;
  label: string;
}

const FILTERS: FilterOption[] = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'stopped', label: '已停止' },
  { key: 'error', label: '异常' },
];

const router = useRouter();
const route = useRoute();
const instancesStore = useInstancesStore();

// 筛选条件和待确认删除项只属于当前视图的临时响应式状态。
const keyword = ref('');
const activeFilter = ref<FilterKey>('all');
const pendingRemoveInstance = ref<Instance | null>(null);
const configuringInstance = ref<Instance | null>(null);
const mofoxPath = ref('');
const platformPaths = ref<Array<{ id: string; path: string }>>([]);
const configurationBusy = ref(false);
const configurationError = ref<string | null>(null);
const configurationLocked = computed(() => {
  const status = configuringInstance.value?.status;
  return status === 'running' || status === 'starting' || status === 'stopping';
});

// 初始化列表，并兼容来自旧入口的日志查询参数跳转。
onMounted(() => {
  instancesStore.refresh();
  const logsQuery = route.query.logs;
  if (typeof logsQuery === 'string' && logsQuery) {
    void router.replace({ name: 'instance-logs', params: { id: logsQuery } });
  }
});

function matchesFilter(status: InstanceStatus, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return status === 'running';
  if (filter === 'stopped') return status === 'stopped';
  return status === 'error';
}

// 搜索关键字和状态筛选共同派生当前可见实例。
const filteredInstances = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return instancesStore.instances.filter((instance) => {
    const matchName = kw === '' || instance.name.toLowerCase().includes(kw);
    return matchName && matchesFilter(instance.status, activeFilter.value);
  });
});

const hasInstances = computed(() => instancesStore.instances.length > 0);
const hasResults = computed(() => filteredInstances.value.length > 0);

function onRefresh(): void {
  instancesStore.refresh();
}

function goInstall(): void {
  router.push({ name: 'install' });
}

function onStart(id: string): void {
  instancesStore.start(id);
}

function onStop(id: string): void {
  instancesStore.stop(id);
}

function onRestart(id: string): void {
  instancesStore.restart(id);
}

function onOpenFolder(id: string): void {
  mofoxApi.openInstanceFolder(id);
}

function openLogs(id: string): void {
  void router.push({ name: 'instance-logs', params: { id } });
}


function closeConfiguration(): void {
  if (configurationBusy.value) return;
  configuringInstance.value = null;
  configurationError.value = null;
}

async function chooseMofoxPath(): Promise<void> {
  const selected = await mofoxApi.pickDirectory({ title: '选择 MoFox 目录', defaultPath: mofoxPath.value || undefined });
  if (selected) mofoxPath.value = selected;
}

function addPlatformPath(): void {
  platformPaths.value.push({ id: '', path: '' });
}

function removePlatformPath(index: number): void {
  if (platformPaths.value.length <= 1) return;
  platformPaths.value.splice(index, 1);
}

async function choosePlatformPath(index: number): Promise<void> {
  const entry = platformPaths.value[index];
  if (!entry) return;
  const selected = await mofoxApi.pickDirectory({ title: `选择 ${entry.id} 目录`, defaultPath: entry.path || undefined });
  if (selected) entry.path = selected;
}

async function saveConfiguration(): Promise<void> {
  if (!configuringInstance.value || configurationLocked.value) return;
  const trimmedMofoxPath = mofoxPath.value.trim();
  const platforms = Object.fromEntries(platformPaths.value.map((entry) => [entry.id.trim(), entry.path.trim()]));
  if (!trimmedMofoxPath || Object.keys(platforms).length === 0 || Object.entries(platforms).some(([id, path]) => !id || !path)) {
    configurationError.value = 'MoFox 目录和平台目录不能为空';
    return;
  }
  configurationBusy.value = true;
  configurationError.value = null;
  try {
    await instancesStore.updatePaths(configuringInstance.value.id, { mofoxInstallDir: trimmedMofoxPath, platforms });
    configuringInstance.value = null;
  } catch (error) {
    configurationError.value = error instanceof Error ? error.message : '保存路径失败';
  } finally {
    configurationBusy.value = false;
  }
}

function requestRemove(id: string): void {
  pendingRemoveInstance.value = instancesStore.byId(id) ?? null;
}

function cancelRemove(): void {
  pendingRemoveInstance.value = null;
}

async function confirmRemove(): Promise<void> {
  if (!pendingRemoveInstance.value) return;
  await instancesStore.remove(pendingRemoveInstance.value.id);
  pendingRemoveInstance.value = null;
}
</script>

<template>
  <div class="instances-view">
    <!-- 标题操作、搜索与筛选工具栏 -->
    <PageHeader title="实例">
      <button class="icon-btn state-layer" type="button" title="刷新" aria-label="刷新" @click="onRefresh">
        <span class="msr" aria-hidden="true">refresh</span>
      </button>
      <button class="btn btn--filled state-layer" type="button" @click="goInstall">新建实例</button>
    </PageHeader>

    <div class="instances-view__body">
      <div class="toolbar">
        <label class="search-box">
          <span class="msr search-box__icon" aria-hidden="true">search</span>
          <input
            v-model="keyword"
            type="text"
            class="search-box__input"
            placeholder="搜索实例名称"
          />
        </label>

        <div class="filter-row">
          <button
            v-for="filter in FILTERS"
            :key="filter.key"
            class="filter-chip state-layer"
            type="button"
            :class="{ 'filter-chip--selected': activeFilter === filter.key }"
            @click="activeFilter = filter.key"
          >
            <span
              v-if="activeFilter === filter.key"
              class="msr filter-chip__icon"
              aria-hidden="true"
              >check</span
            >
            {{ filter.label }}
          </button>
        </div>
      </div>

      <div v-if="!hasInstances" class="empty-state">
        <span class="msr empty-state__icon" aria-hidden="true">deployed_code</span>
        <p class="empty-state__text">还没有任何实例，安装一个即可开始使用</p>
        <button class="btn btn--filled state-layer" type="button" @click="goInstall">
          去安装
        </button>
      </div>

      <div v-else-if="!hasResults" class="empty-state">
        <span class="msr empty-state__icon" aria-hidden="true">search_off</span>
        <p class="empty-state__text">没有找到匹配的实例，换个关键词或筛选条件试试</p>
      </div>

      <div v-else class="instances-grid">
        <InstanceCard
          v-for="instance in filteredInstances"
          :key="instance.id"
          :instance="instance"
          @start="onStart"
          @stop="onStop"
          @restart="onRestart"
          @logs="openLogs"
          @remove="requestRemove"
          @open-folder="onOpenFolder"
        />
      </div>
    </div>

    <BaseDialog
      :open="configuringInstance !== null"
      title="配置实例路径"
      :width="560"
      @close="closeConfiguration"
    >
      <div class="path-dialog">
        <p v-if="configurationLocked" class="path-dialog__notice">
          当前实例正在运行。停止实例后才能保存路径修改。
        </p>
        <div class="path-field">
          <label class="path-field__label" for="mofox-path">MoFox 目录</label>
          <div class="path-field__control">
            <input id="mofox-path" v-model="mofoxPath" class="path-field__input" type="text" :disabled="configurationLocked" />
            <button class="icon-btn state-layer" type="button" title="选择目录" aria-label="选择 MoFox 目录" :disabled="configurationLocked" @click="chooseMofoxPath">
              <span class="msr" aria-hidden="true">folder_open</span>
            </button>
          </div>
        </div>

        <div v-for="(entry, index) in platformPaths" :key="index" class="platform-path-row">
          <label class="path-field">
            <span class="path-field__label">平台 ID</span>
            <input v-model="entry.id" class="path-field__input" type="text" placeholder="snowluma" :disabled="configurationLocked" />
          </label>
          <div class="path-field">
            <span class="path-field__label">平台目录</span>
            <div class="path-field__control path-field__control--platform">
              <input v-model="entry.path" class="path-field__input" type="text" :disabled="configurationLocked" />
              <button class="icon-btn state-layer" type="button" title="选择目录" :aria-label="`选择 ${entry.id || '平台'} 目录`" :disabled="configurationLocked" @click="choosePlatformPath(index)">
                <span class="msr" aria-hidden="true">folder_open</span>
              </button>
              <button class="icon-btn state-layer" type="button" title="移除平台" aria-label="移除平台" :disabled="configurationLocked || platformPaths.length <= 1" @click="removePlatformPath(index)">
                <span class="msr" aria-hidden="true">remove_circle</span>
              </button>
            </div>
          </div>
        </div>

        <button class="btn btn--text path-dialog__add state-layer" type="button" :disabled="configurationLocked" @click="addPlatformPath">
          <span class="msr" aria-hidden="true">add</span>
          添加平台
        </button>
        <p v-if="configurationError" class="path-dialog__error">{{ configurationError }}</p>
      </div>
      <template #actions>
        <button class="btn btn--text state-layer" type="button" :disabled="configurationBusy" @click="closeConfiguration">取消</button>
        <button class="btn btn--filled state-layer" type="button" :disabled="configurationBusy || configurationLocked" @click="saveConfiguration">保存</button>
      </template>
    </BaseDialog>

    <!-- 删除操作必须经确认对话框后才提交到实例仓库 -->
    <BaseDialog
      :open="pendingRemoveInstance !== null"
      title="删除实例"
      :width="320"
      @close="cancelRemove"
    >
      <p v-if="pendingRemoveInstance" class="remove-dialog__body">
        确定要删除实例「{{ pendingRemoveInstance.name }}」吗？此操作无法撤销。
      </p>
      <template #actions>
        <button class="btn btn--text state-layer" type="button" @click="cancelRemove">
          取消
        </button>
        <button class="btn btn--error state-layer" type="button" @click="confirmRemove">
          删除
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
/* 页面容器、筛选工具栏与实例网格 */
.instances-view {
  height: 100%;
  overflow-y: auto;
  position: relative;
}

.instances-view__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 0 32px 32px;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 16px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--app-glass-border);
  background: var(--md-sys-color-surface-container);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.search-box__icon {
  color: var(--md-sys-color-on-surface-variant);
}

.search-box__input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
}

.search-box__input::placeholder {
  color: var(--md-sys-color-on-surface-variant);
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.filter-chip__icon {
  font-size: 18px;
}

.filter-chip--selected {
  border-color: transparent;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.instances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

/* 空列表和无搜索结果提示 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 32px;
  text-align: center;
}

.empty-state__icon {
  font-size: 64px;
  color: var(--md-sys-color-on-surface-variant);
}

.empty-state__text {
  margin: 0;
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
}

.btn {
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--text {
  padding: 0 12px;
  background: transparent;
  color: var(--md-sys-color-primary);
}

.btn--error {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
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

.path-dialog {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.path-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.path-field__label {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
}

.path-field__control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  align-items: center;
  gap: 8px;
}

.path-field__control--platform {
  grid-template-columns: minmax(0, 1fr) 40px 40px;
}

.path-field__input {
  width: 100%;
  min-width: 0;
  height: 48px;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-small);
  outline: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  font-family: var(--md-ref-typeface-mono);
}

.path-field__input:focus {
  border: 2px solid var(--md-sys-color-primary);
  padding: 0 13px;
}

.platform-path-row {
  display: grid;
  grid-template-columns: minmax(120px, 0.35fr) minmax(0, 1fr);
  gap: 12px;
  padding-top: 18px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.path-dialog__add {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

@media (max-width: 680px) {
  .platform-path-row {
    grid-template-columns: 1fr;
  }
}

.path-dialog__notice {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-body-medium);
}

.path-field__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.path-dialog__error {
  margin: 0;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-small);
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.remove-dialog__body {
  margin: 0;
}
</style>
