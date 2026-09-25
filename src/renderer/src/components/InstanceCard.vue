<script setup lang="ts">
import { computed } from 'vue';
import type { Instance } from '@shared/domain/instance';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ instance: Instance }>();

const emit = defineEmits<{
  start: [id: string];
  stop: [id: string];
  restart: [id: string];
  logs: [id: string];
  manage: [id: string];
}>();

const isRunning = computed(() => props.instance.status === 'running');
const isBusy = computed(
  () => props.instance.status === 'starting' || props.instance.status === 'stopping',
);
const isLike = computed(() => props.instance.extra?.isLike === true);
const platform = computed(() => props.instance.platform);
const platformName = computed(() => {
  const id = platform.value?.id;
  if (!id) return '未安装平台';
  if (id === 'snowluma') return 'SnowLuma';
  if (id === 'napcat') return 'NapCat';
  return id;
});
const platformVersion = computed(() => platform.value?.version?.replace(/^v/i, '') ?? '');
const installPath = computed(() => props.instance.mofoxInstallDir);
const primaryLabel = computed(() => {
  if (props.instance.status === 'starting') return '正在启动';
  if (props.instance.status === 'stopping') return '正在停止';
  return isRunning.value ? '停止实例' : '启动实例';
});
const primaryIcon = computed(() => {
  if (isBusy.value) return 'progress_activity';
  return isRunning.value ? 'stop' : 'play_arrow';
});

function onPrimaryAction(): void {
  if (isBusy.value) return;
  if (isRunning.value) emit('stop', props.instance.id);
  else emit('start', props.instance.id);
}
</script>

<template>
  <article
    class="instance-card"
    :class="{
      'instance-card--running': isRunning,
      'instance-card--busy': isBusy,
      'instance-card--error': instance.status === 'error',
    }"
  >
    <header class="instance-card__head">
      <span class="instance-card__mark" aria-hidden="true">
        <span class="msr msr--fill">smart_toy</span>
      </span>
      <div class="instance-card__identity">
        <div class="instance-card__name-row">
          <h3>{{ instance.name }}</h3>
          <span
            v-if="isLike"
            class="msr instance-card__favorite msr--fill"
            title="已收藏"
            aria-label="已收藏"
            >favorite</span
          >
        </div>
        <span class="instance-card__platform">
          {{ platformName }}<template v-if="platformVersion"> · v{{ platformVersion }}</template>
        </span>
      </div>
      <StatusBadge :status="instance.status" />
    </header>

    <div class="instance-card__details">
      <span class="msr" aria-hidden="true">folder</span>
      <span :title="installPath">{{ installPath || '尚未记录安装目录' }}</span>
    </div>

    <div
      v-if="isBusy"
      class="instance-card__progress"
      role="progressbar"
      aria-label="实例状态切换中"
    >
      <div class="instance-card__progress-bar"></div>
    </div>

    <footer class="instance-card__actions">
      <button
        type="button"
        class="instance-card__primary state-layer"
        :class="{ 'instance-card__primary--stop': isRunning }"
        :disabled="isBusy"
        @click="onPrimaryAction"
      >
        <span class="msr" :class="{ 'instance-card__spin': isBusy }" aria-hidden="true">
          {{ primaryIcon }}
        </span>
        {{ primaryLabel }}
      </button>

      <div class="instance-card__secondary" aria-label="实例辅助操作">
        <button
          v-if="isRunning"
          class="instance-card__icon-button state-layer"
          type="button"
          title="重启"
          aria-label="重启实例"
          :disabled="isBusy"
          @click="emit('restart', instance.id)"
        >
          <span class="msr" aria-hidden="true">restart_alt</span>
        </button>
        <button
          class="instance-card__icon-button state-layer"
          type="button"
          title="查看日志"
          aria-label="查看日志"
          @click="emit('logs', instance.id)"
        >
          <span class="msr" aria-hidden="true">terminal</span>
        </button>
        <button
          class="instance-card__icon-button state-layer"
          type="button"
          title="管理实例"
          aria-label="管理实例"
          @click="emit('manage', instance.id)"
        >
          <span class="msr" aria-hidden="true">tune</span>
        </button>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.instance-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--app-glass-border);
  border-radius: 24px;
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-card-filter);
  -webkit-backdrop-filter: var(--app-glass-card-filter);
  color: var(--md-sys-color-on-surface);
  transition: box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

@media (hover: hover) and (pointer: fine) {
  .instance-card:hover {
    box-shadow: var(--app-glass-card-shadow-hover);
  }
}

.instance-card__head {
  min-width: 0;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.instance-card__mark {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.instance-card--running .instance-card__mark {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.instance-card--error .instance-card__mark {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.instance-card__mark .msr {
  font-size: 27px;
}

.instance-card__identity {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.instance-card__name-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.instance-card__name-row h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-card__favorite {
  flex: none;
  color: var(--md-sys-color-tertiary);
  font-size: 17px;
}

.instance-card__platform {
  overflow: hidden;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-card__details {
  min-width: 0;
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 14px;
  background: var(--app-glass-row);
  color: var(--md-sys-color-on-surface-variant);
}

.instance-card__details .msr {
  flex: none;
  font-size: 19px;
}

.instance-card__details span:last-child {
  min-width: 0;
  overflow: hidden;
  font: var(--md-sys-typescale-body-small);
  font-family: var(--md-ref-typeface-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-card__progress {
  height: 4px;
  overflow: hidden;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-primary) 18%, transparent);
}

.instance-card__progress-bar {
  width: 38%;
  height: 100%;
  border-radius: inherit;
  background: var(--md-sys-color-primary);
  animation: instance-progress 1.2s linear infinite;
}

@keyframes instance-progress {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(285%);
  }
}

.instance-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.instance-card__primary {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.instance-card__primary--stop {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.instance-card__primary:disabled,
.instance-card__icon-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.instance-card__primary .msr {
  font-size: 20px;
}

.instance-card__secondary {
  flex: none;
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-high);
}

.instance-card__icon-button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}

.instance-card__icon-button .msr {
  font-size: 20px;
}

.instance-card__spin {
  animation: instance-spin 0.9s linear infinite;
}

@keyframes instance-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .instance-card,
  .instance-card__progress-bar,
  .instance-card__spin {
    animation: none;
    transition-duration: var(--md-sys-motion-duration-short2);
  }
}
</style>
