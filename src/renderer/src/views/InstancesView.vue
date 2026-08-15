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
    <!-- 标题与搜索区共用带模糊背景和圆角的容器 -->
    <section class="instances-view__panel">
      <PageHeader title="实例">
        <button class="icon-btn state-layer" type="button" title="刷新" aria-label="刷新" @click="onRefresh">
          <span class="msr" aria-hidden="true">refresh</span>
        </button>
      </PageHeader>

      <div class="instances-view__toolbar">
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
    </section>

    <div class="instances-view__body">
      <div v-if="!hasInstances" class="empty-state">
        <span class="msr empty-state__icon" aria-hidden="true">deployed_code</span>
        <p class="empty-state__text">还没有任何实例，请使用左上角加号添加实例</p>
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

/* 标题与搜索区共用的模糊容器：无圆角，整条覆盖顶部 */
.instances-view__panel {
  padding: 20px 32px 24px;
  border-bottom: 1px solid var(--app-glass-border);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

/* 容器内的标题栏去掉自带内边距，由容器统一排版 */
.instances-view__panel :deep(.page-header) {
  padding: 0 0 16px;
}

.instances-view__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 0 32px 32px;
}

.instances-view__toolbar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 搜索框在模糊容器内使用实色底，避免嵌套玻璃造成重复模糊 */
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding: 0 16px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--app-glass-border);
  background: var(--md-sys-color-surface-container-high);
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

/* 卡片瀑布区仅在壁纸背景存在时铺约 25% 不透明平面（不做模糊）；
   无壁纸时沿用外壳表面，不需要额外的透明度处理。 */
.instances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  padding: 20px;
  border-radius: var(--md-sys-shape-corner-extra-large);
}

:global(.shell--has-wallpaper) .instances-grid {
  border: 1px solid var(--app-glass-border);
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 25%, transparent);
  box-shadow: var(--app-glass-card-shadow);
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

.remove-dialog__body {
  margin: 0;
}
</style>
