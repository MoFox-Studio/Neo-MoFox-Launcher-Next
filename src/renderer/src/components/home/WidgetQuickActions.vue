<script setup lang="ts">
// 快捷操作部件：按用户配置渲染常用功能按钮，动作逻辑统一由 quick-actions 收口。
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { QuickActionId, QuickActionsWidgetConfig } from '@shared/domain/home';
import { QUICK_ACTION_IDS } from '@shared/domain/home';
import HomeWidgetCard from './HomeWidgetCard.vue';
import { QUICK_ACTION_DEFINITIONS, runQuickAction } from '@/utils/quick-actions';

const props = defineProps<{ config: QuickActionsWidgetConfig }>();

const router = useRouter();

/** 过滤到合法动作的渲染列表，保持用户配置顺序。 */
const actions = computed(() =>
  props.config.actions.filter((id) => (QUICK_ACTION_IDS as readonly string[]).includes(id)),
);

function onRun(id: QuickActionId): void {
  runQuickAction(id, { router });
}
</script>

<template>
  <HomeWidgetCard title="快捷操作" icon="bolt">
    <div v-if="actions.length > 0" class="quick-actions-widget__row">
      <button
        v-for="action in actions"
        :key="action"
        type="button"
        class="quick-actions-widget__button state-layer"
        @click="onRun(action)"
      >
        <span class="msr" aria-hidden="true">
          {{ QUICK_ACTION_DEFINITIONS.find((entry) => entry.id === action)?.icon }}
        </span>
        {{ QUICK_ACTION_DEFINITIONS.find((entry) => entry.id === action)?.label }}
      </button>
    </div>

    <p v-else class="quick-actions-widget__empty">尚未选择任何动作，可在「设置 → 主页」中配置。</p>
  </HomeWidgetCard>
</template>

<style scoped>
.quick-actions-widget__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.quick-actions-widget__button {
  flex: 1 1 150px;
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 18px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--app-glass-row);
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.quick-actions-widget__button .msr {
  font-size: 20px;
  color: var(--md-sys-color-primary);
}

.quick-actions-widget__empty {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}
</style>
