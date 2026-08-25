<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { InstanceStatus } from '@shared/domain/instance';
import { useInstancesStore } from '@/stores/instances';
import { useWindowTitle } from '@/composables/use-window-title';
import InstanceCard from '@/components/InstanceCard.vue';

// 实例管理页提供搜索、状态筛选与卡片操作分发。
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

// 实例页标题显示在窗口栏。
useWindowTitle({ title: '实例', subtitle: '管理并启动你的机器人实例' });

// 筛选条件和搜索关键字只属于当前视图的临时响应式状态。
const keyword = ref('');
const activeFilter = ref<FilterKey>('all');

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

function openLogs(id: string): void {
  void router.push({ name: 'instance-logs', params: { id } });
}

function onManage(id: string): void {
  void router.push({ name: 'instance-manage', params: { id } });
}
</script>

<template>
  <div class="instances-view">
    <!-- 搜索与筛选工具栏共用带模糊背景的容器 -->
    <section class="instances-view__panel">
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

        <div class="instances-view__toolbar-row">
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
          <button
            class="icon-btn state-layer"
            type="button"
            title="刷新"
            aria-label="刷新"
            @click="onRefresh"
          >
            <span class="msr" aria-hidden="true">refresh</span>
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
          @manage="onManage"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 页面容器、筛选工具栏与实例网格 */
.instances-view {
  height: 100%;
  overflow-y: auto;
  position: relative;
}

/* 搜索与筛选共用的模糊容器：无圆角，整条覆盖顶部 */
.instances-view__panel {
  padding: 24px 32px 24px;
  border-bottom: 1px solid var(--app-glass-border);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
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

.instances-view__toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

/* 卡片瀑布区直接落在内容画布上，不再单独铺设壁纸专用平面。 */
.instances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  padding: 20px;
  border-radius: var(--md-sys-shape-corner-extra-large);
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
</style>
