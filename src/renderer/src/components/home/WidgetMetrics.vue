<script setup lang="ts">
// 仪表盘部件：按用户配置的指标集合展示实例状态概览，点击跳转实例列表。
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { HomeMetricId, MetricsWidgetConfig } from '@shared/domain/home';
import { HOME_METRIC_IDS } from '@shared/domain/home';
import { useInstancesStore } from '@/stores/instances';

const props = defineProps<{ config: MetricsWidgetConfig }>();

const router = useRouter();
const instancesStore = useInstancesStore();

/** 指标的图标、名称与取值。 */
const METRIC_META: Record<HomeMetricId, { icon: string; label: string; accent?: boolean }> = {
  total: { icon: 'apps', label: '全部实例' },
  favorites: { icon: 'favorite', label: '收藏实例' },
  running: { icon: 'play_arrow', label: '正在运行', accent: true },
  error: { icon: 'error', label: '需要处理' },
  platforms: { icon: 'deployed_code', label: '平台类型' },
};

const counts = computed<Record<HomeMetricId, number>>(() => {
  const instances = instancesStore.instances;
  return {
    total: instances.length,
    favorites: instances.filter((instance) => instance.extra?.isLike === true).length,
    running: instances.filter((instance) => instance.status === 'running').length,
    error: instances.filter((instance) => instance.status === 'error').length,
    platforms: new Set(
      instances.map((instance) => instance.platform?.id).filter(Boolean),
    ).size,
  };
});

/** 过滤到合法指标的渲染列表，保持用户配置顺序。 */
const visibleMetrics = computed(() =>
  props.config.items.filter((id) => (HOME_METRIC_IDS as readonly string[]).includes(id)),
);

function openInstances(): void {
  void router.push({ name: 'instances' });
}
</script>

<template>
  <section class="metric-widget" aria-label="实例状态概览">
    <button
      v-for="metric in visibleMetrics"
      :key="metric"
      type="button"
      class="metric-widget__item state-layer"
      :class="{ 'metric-widget__item--accent': METRIC_META[metric].accent }"
      @click="openInstances"
    >
      <span class="metric-widget__icon">
        <span class="msr" :class="{ 'msr--fill': metric === 'favorites' || metric === 'running' }">
          {{ METRIC_META[metric].icon }}
        </span>
      </span>
      <span class="metric-widget__copy">
        <strong>{{ counts[metric] }}</strong>
        <small>{{ METRIC_META[metric].label }}</small>
      </span>
    </button>

    <p v-if="visibleMetrics.length === 0" class="metric-widget__empty">
      尚未选择任何指标，可在「设置 → 主页」中配置。
    </p>
  </section>
</template>

<style scoped>
.metric-widget {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.metric-widget__item {
  flex: 1 1 180px;
  min-height: 86px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border: 0;
  border-radius: 14px;
  background: var(--app-glass-row);
  color: var(--md-sys-color-on-surface);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.metric-widget__item:hover {
  background: var(--md-sys-color-surface-container-high);
}

.metric-widget__icon {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.metric-widget__icon .msr {
  font-size: 24px;
}

.metric-widget__item--accent .metric-widget__icon {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.metric-widget__copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.metric-widget__copy strong {
  font: var(--md-sys-typescale-title-large);
  font-variant-numeric: tabular-nums;
}

.metric-widget__copy small {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.metric-widget__empty {
  margin: 0;
  padding: 18px 20px;
  border-radius: 14px;
  background: var(--app-glass-row);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}
</style>
