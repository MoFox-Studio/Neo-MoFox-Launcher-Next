<script setup lang="ts">
import { computed } from 'vue';
import type { Instance } from '@shared/domain/instance';
import StatusBadge from './StatusBadge.vue';

interface Props {
  instance: Instance;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  start: [id: string];
  stop: [id: string];
  restart: [id: string];
  remove: [id: string];
  logs: [id: string];
  'open-folder': [id: string];
}>();

const isRunning = computed(() => props.instance.status === 'running');
const isBusy = computed(
  () => props.instance.status === 'starting' || props.instance.status === 'stopping',
);

function onPrimaryAction(): void {
  if (isBusy.value) return;
  if (isRunning.value) emit('stop', props.instance.id);
  else emit('start', props.instance.id);
}
</script>

<template>
  <article class="instance-card">
    <header class="instance-card__head">
      <h3 class="instance-card__name">{{ instance.name }}</h3>
      <StatusBadge :status="instance.status" />
    </header>

    <div class="instance-card__meta">
      <span class="instance-card__chip">{{ instance.platformId }}</span>
      <span class="instance-card__version">v{{ instance.version }}</span>
    </div>

    <p class="instance-card__path" :title="instance.installPath">{{ instance.installPath }}</p>

    <div v-if="isBusy" class="instance-card__progress" role="progressbar" aria-label="处理中">
      <div class="instance-card__progress-bar"></div>
    </div>

    <div class="instance-card__actions">
      <button
        v-if="isRunning"
        class="btn btn--tonal state-layer"
        type="button"
        :disabled="isBusy"
        @click="onPrimaryAction"
      >
        停止
      </button>
      <button
        v-else
        class="btn btn--filled state-layer"
        type="button"
        :disabled="isBusy"
        @click="onPrimaryAction"
      >
        启动
      </button>

      <button
        v-if="isRunning"
        class="icon-btn state-layer"
        type="button"
        title="重启"
        aria-label="重启"
        :disabled="isBusy"
        @click="emit('restart', instance.id)"
      >
        <span class="msr" aria-hidden="true">restart_alt</span>
      </button>

      <span class="instance-card__spacer"></span>

      <button
        class="icon-btn state-layer"
        type="button"
        title="查看日志"
        aria-label="查看日志"
        @click="emit('logs', instance.id)"
      >
        <span class="msr" aria-hidden="true">terminal</span>
      </button>
      <button
        class="icon-btn state-layer"
        type="button"
        title="打开目录"
        aria-label="打开目录"
        @click="emit('open-folder', instance.id)"
      >
        <span class="msr" aria-hidden="true">folder_open</span>
      </button>
      <button
        class="icon-btn state-layer"
        type="button"
        title="删除"
        aria-label="删除"
        @click="emit('remove', instance.id)"
      >
        <span class="msr" aria-hidden="true">delete</span>
      </button>
    </div>
  </article>
</template>

<style scoped>
.instance-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-low);
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.instance-card:hover {
  background: var(--md-sys-color-surface-container);
  box-shadow: var(--md-sys-elevation-level1);
}

.instance-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.instance-card__name {
  margin: 0;
  font: var(--md-sys-typescale-title-medium);
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.instance-card__chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-small);
}

.instance-card__version {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.instance-card__path {
  margin: 0;
  font: var(--md-sys-typescale-body-small);
  font-family: var(--md-ref-typeface-mono);
  color: var(--md-sys-color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-card__progress {
  height: 3px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-tertiary) 24%, transparent);
  overflow: hidden;
}

.instance-card__progress-bar {
  width: 40%;
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-tertiary);
  animation: instance-card-indeterminate 1.2s var(--md-sys-motion-easing-standard) infinite;
}

@keyframes instance-card-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}

.instance-card__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.instance-card__spacer {
  flex: 1;
}

.btn {
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition: box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
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
</style>
