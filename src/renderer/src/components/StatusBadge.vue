<script setup lang="ts">
import { computed } from 'vue';
import type { InstanceStatus } from '@shared/domain/instance';

interface Props {
  status: InstanceStatus;
}

const props = defineProps<Props>();

const STATUS_LABEL: Record<InstanceStatus, string> = {
  running: '运行中',
  stopped: '已停止',
  starting: '启动中',
  stopping: '停止中',
  error: '异常',
};

const label = computed(() => STATUS_LABEL[props.status]);
const isTransitioning = computed(() => props.status === 'starting' || props.status === 'stopping');
</script>

<template>
  <span
    class="status-badge"
    :class="[
      `status-badge--${status}`,
      { 'status-badge--pulsing': isTransitioning },
    ]"
  >
    <span class="status-badge__dot"></span>
    <span class="status-badge__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-medium);
  white-space: nowrap;
}

.status-badge__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: currentColor;
  flex-shrink: 0;
}

.status-badge--pulsing .status-badge__dot {
  animation: status-badge-pulse 1.4s var(--md-sys-motion-easing-standard) infinite;
}

.status-badge--running {
  background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent);
  color: var(--md-sys-color-primary);
}

.status-badge--stopped {
  background: var(--md-sys-color-surface-variant);
  color: var(--md-sys-color-on-surface-variant);
}

.status-badge--starting,
.status-badge--stopping {
  background: color-mix(in srgb, var(--md-sys-color-tertiary) 12%, transparent);
  color: var(--md-sys-color-tertiary);
}

.status-badge--error {
  background: color-mix(in srgb, var(--md-sys-color-error) 12%, transparent);
  color: var(--md-sys-color-error);
}

@keyframes status-badge-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}
</style>
