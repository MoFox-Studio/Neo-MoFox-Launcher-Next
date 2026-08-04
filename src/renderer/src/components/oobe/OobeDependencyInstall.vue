<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useOobeStore } from '@/stores/oobe';
import { MofoxError } from '@shared/domain/error';
import type { OobeDependencyStatus } from '@shared/domain/oobe';

const oobe = useOobeStore();

const emit = defineEmits<{ (e: 'next'): void; (e: 'back'): void }>();

const hasFailure = computed(() => oobe.dependencies.some((d) => d.status === 'failed'));
const allDone = computed(
  () =>
    oobe.dependencies.length > 0 &&
    oobe.dependencies.every((d) => d.status === 'installed' || d.status === 'skipped'),
);

function statusIcon(status: OobeDependencyStatus['status']): string {
  switch (status) {
    case 'installed':
    case 'skipped':
      return 'check_circle';
    case 'failed':
      return 'error';
    case 'installing':
      return 'progress_activity';
    default:
      return 'pending';
  }
}

function statusLabel(status: OobeDependencyStatus['status']): string {
  switch (status) {
    case 'installed':
      return '已安装';
    case 'skipped':
      return '已存在';
    case 'failed':
      return '失败';
    case 'installing':
      return '安装中';
    default:
      console.log(`Unknown dependency status: ${status}`);
      return '等待中';
  }
}

async function startInstall(): Promise<void> {
  await oobe.installDependencies();
}

async function retryInstall(): Promise<void> {
  oobe.reset();
  await startInstall();
}

onMounted(() => {
  oobe.subscribe();
  if (oobe.dependencies.length === 0) {
    void startInstall();
  }
});

onUnmounted(() => {
  oobe.dispose();
});

function describeError(error: unknown): string {
  if (error instanceof MofoxError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}
</script>

<template>
  <section class="oobe-step">
    <h2 class="oobe__step-title">依赖安装</h2>
    <p class="oobe__step-desc">正在检查并安装运行 Neo-MoFox 所需的工具</p>

    <ul class="dep-list">
      <li v-for="dep in oobe.dependencies" :key="dep.id" class="dep-list__item" :class="`dep-list__item--${dep.status}`">
        <span class="msr dep-list__icon" :class="{ 'dep-list__icon--spin': dep.status === 'installing' }" aria-hidden="true">
          {{ statusIcon(dep.status) }}
        </span>
        <div class="dep-list__body">
          <span class="dep-list__name">{{ dep.displayName }}</span>
          <span v-if="dep.message" class="dep-list__message">{{ dep.message }}</span>
        </div>
        <span class="dep-list__status" :class="`dep-list__status--${dep.status}`">
          {{ statusLabel(dep.status) }}
        </span>
      </li>
      <li v-if="oobe.dependencies.length === 0" class="dep-list__empty">
        <span class="spinner" aria-hidden="true"></span>
        <span>正在准备安装清单…</span>
      </li>
    </ul>

    <p v-if="oobe.currentMessage && oobe.installing" class="dep-current">{{ oobe.currentMessage }}</p>

    <div class="dep-actions">
      <button type="button" class="btn btn--text state-layer" :disabled="oobe.installing" @click="emit('back')">
        上一步
      </button>
      <button
        v-if="hasFailure"
        type="button"
        class="btn btn--filled state-layer"
        :disabled="oobe.installing"
        @click="retryInstall"
      >
        <span v-if="oobe.installing" class="spinner spinner--small" aria-hidden="true"></span>
        重试失败项
      </button>
      <button
        v-else
        type="button"
        class="btn btn--filled state-layer"
        :disabled="!allDone || oobe.installing"
        @click="emit('next')"
      >
        继续
      </button>
    </div>

    <p v-if="hasFailure" class="dep-error-hint">部分依赖安装失败，可点击「重试失败项」重新安装全部依赖，或稍后在设置页手动安装。</p>
    <p v-else-if="describeError" class="dep-error-hint dep-error-hint--hidden">{{ describeError }}</p>
  </section>
</template>

<style scoped>
.dep-list {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dep-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.dep-list__icon {
  font-size: 20px;
  color: var(--md-sys-color-on-surface-variant);
}

.dep-list__icon--spin {
  animation: dep-spin 1.2s linear infinite;
}

.dep-list__item--installed .dep-list__icon,
.dep-list__item--skipped .dep-list__icon {
  color: var(--md-sys-color-tertiary);
}

.dep-list__item--failed .dep-list__icon {
  color: var(--md-sys-color-error);
}

.dep-list__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dep-list__name {
  font: var(--md-sys-typescale-body-large);
}

.dep-list__message {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.dep-list__status {
  font: var(--md-sys-typescale-label-medium);
  padding: 4px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}

.dep-list__status--installed,
.dep-list__status--skipped {
  color: var(--md-sys-color-tertiary);
  border-color: var(--md-sys-color-tertiary);
}

.dep-list__status--failed {
  color: var(--md-sys-color-error);
  border-color: var(--md-sys-color-error);
}

.dep-list__status--installing {
  color: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.dep-list__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 4px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.dep-current {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 16px;
}

.dep-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.dep-error-hint {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-error);
  margin: 12px 0 0;
}

.dep-error-hint--hidden {
  display: none;
}

.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  overflow: hidden;
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
  padding: 0 12px;
}

.spinner {
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-primary);
  animation: spinner-spin 0.8s linear infinite;
}

.spinner--small {
  width: 14px;
  height: 14px;
  border-width: 2px;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes dep-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
