<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { InstanceStatus } from '@shared/domain/instance';
import { useInstancesStore } from '@/stores/instances';
import { useWindowTitle } from '@/composables/use-window-title';
import InstanceCard from '@/components/InstanceCard.vue';

type FilterKey = 'all' | 'running' | 'stopped' | 'error';

const FILTERS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: 'apps' },
  { key: 'running', label: '运行中', icon: 'play_circle' },
  { key: 'stopped', label: '已停止', icon: 'stop_circle' },
  { key: 'error', label: '异常', icon: 'error' },
];

const router = useRouter();
const route = useRoute();
const instancesStore = useInstancesStore();

useWindowTitle({ title: '实例', subtitle: '管理并启动你的机器人实例' });

const keyword = ref('');
const activeFilter = ref<FilterKey>('all');

onMounted(() => {
  void instancesStore.refresh();
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

const filteredInstances = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase();
  return instancesStore.instances.filter((instance) => {
    const matchesKeyword =
      normalizedKeyword === '' || instance.name.toLowerCase().includes(normalizedKeyword);
    return matchesKeyword && matchesFilter(instance.status, activeFilter.value);
  });
});

const hasInstances = computed(() => instancesStore.instances.length > 0);
const hasResults = computed(() => filteredInstances.value.length > 0);
const resultLabel = computed(() => {
  if (!hasInstances.value) return '暂无实例';
  if (filteredInstances.value.length === instancesStore.instances.length) {
    return `共 ${instancesStore.instances.length} 个实例`;
  }
  return `显示 ${filteredInstances.value.length} / ${instancesStore.instances.length}`;
});

function filterCount(filter: FilterKey): number {
  return instancesStore.instances.filter((instance) => matchesFilter(instance.status, filter))
    .length;
}

function onRefresh(): void {
  void instancesStore.refresh();
}

function onStart(id: string): void {
  void instancesStore.start(id);
}

function onStop(id: string): void {
  void instancesStore.stop(id);
}

function onRestart(id: string): void {
  void instancesStore.restart(id);
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
    <div class="instances-view__layout">
      <section class="instance-tools" aria-label="实例筛选">
        <label class="search-box">
          <span class="msr" aria-hidden="true">search</span>
          <input v-model="keyword" type="search" placeholder="搜索实例名称" />
          <button
            v-if="keyword"
            type="button"
            class="search-box__clear state-layer"
            title="清空搜索"
            aria-label="清空搜索"
            @click="keyword = ''"
          >
            <span class="msr" aria-hidden="true">close</span>
          </button>
        </label>

        <div class="filter-segments" role="tablist" aria-label="运行状态">
          <button
            v-for="filter in FILTERS"
            :key="filter.key"
            type="button"
            role="tab"
            class="filter-segment state-layer"
            :class="{ 'filter-segment--selected': activeFilter === filter.key }"
            :aria-selected="activeFilter === filter.key"
            @click="activeFilter = filter.key"
          >
            <span class="msr" aria-hidden="true">{{ filter.icon }}</span>
            <span>{{ filter.label }}</span>
            <small>{{ filterCount(filter.key) }}</small>
          </button>
        </div>

        <div class="instance-tools__tail">
          <span>{{ resultLabel }}</span>
          <button
            class="refresh-button state-layer"
            type="button"
            title="刷新实例"
            aria-label="刷新实例"
            @click="onRefresh"
          >
            <span class="msr" aria-hidden="true">refresh</span>
          </button>
        </div>
      </section>

      <div v-if="!hasInstances" class="empty-state">
        <span class="empty-state__mark" aria-hidden="true"
          ><span class="msr">deployed_code</span></span
        >
        <h2>还没有实例</h2>
        <p>使用主导航中的添加按钮，新鲜安装或导入一个已有实例。</p>
      </div>

      <div v-else-if="!hasResults" class="empty-state">
        <span class="empty-state__mark" aria-hidden="true"
          ><span class="msr">search_off</span></span
        >
        <h2>没有匹配结果</h2>
        <p>换一个关键词或状态筛选试试。</p>
        <button
          type="button"
          class="empty-state__action state-layer"
          @click="
            keyword = '';
            activeFilter = 'all';
          "
        >
          清除筛选
        </button>
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
.instances-view {
  height: 100%;
  overflow-y: auto;
}

.instances-view__layout {
  width: min(100%, 1240px);
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin: 0 auto;
  padding: 28px 32px calc(36px + var(--app-nav-overlay-bottom-inset))
    calc(32px + var(--app-nav-overlay-start-inset));
}

.instance-tools {
  min-height: 76px;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 24px;
  background: var(--md-sys-color-surface-container-low);
}

.search-box {
  min-width: 0;
  height: 50px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 15px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}

.search-box > .msr {
  flex: none;
  font-size: 22px;
}

.search-box input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
}

.search-box input::-webkit-search-cancel-button {
  appearance: none;
}

.search-box input::placeholder {
  color: var(--md-sys-color-on-surface-variant);
}

.search-box:focus-within {
  box-shadow: inset 0 0 0 2px var(--md-sys-color-primary);
}

.search-box__clear,
.refresh-button {
  flex: none;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}

.search-box__clear .msr,
.refresh-button .msr {
  font-size: 20px;
}

.filter-segments {
  display: flex;
  gap: 3px;
}

.filter-segment {
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition:
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.filter-segment:first-child {
  border-radius: 16px 6px 6px 16px;
}

.filter-segment:last-child {
  border-radius: 6px 16px 16px 6px;
}

.filter-segment--selected {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.filter-segment .msr {
  display: none;
  font-size: 18px;
}

.filter-segment--selected .msr {
  display: inline-block;
}

.filter-segment small {
  min-width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  padding: 0 5px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, currentColor 10%, transparent);
  color: inherit;
  font: var(--md-sys-typescale-label-small);
}

.instance-tools__tail {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  white-space: nowrap;
}

.refresh-button {
  width: 44px;
  height: 44px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.instances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 12px;
}

.empty-state {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 32px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-low);
  text-align: center;
}

.empty-state__mark {
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  margin-bottom: 9px;
  border-radius: 23px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.empty-state__mark .msr {
  font-size: 36px;
}

.empty-state h2,
.empty-state p {
  margin: 0;
}

.empty-state h2 {
  font: var(--md-sys-typescale-title-large);
}

.empty-state p {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.empty-state__action {
  min-height: 40px;
  margin-top: 8px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

@media (max-width: 980px) {
  .instance-tools {
    grid-template-columns: 1fr auto;
  }

  .filter-segments {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .instance-tools__tail > span {
    display: none;
  }
}

@media (max-width: 640px) {
  .instances-view__layout {
    padding: 18px 18px calc(28px + var(--app-nav-overlay-bottom-inset))
      calc(18px + var(--app-nav-overlay-start-inset));
  }

  .instance-tools {
    grid-template-columns: 1fr auto;
  }

  .filter-segments {
    width: 100%;
    overflow-x: auto;
  }

  .filter-segment {
    flex: 1 0 auto;
  }
}
</style>
