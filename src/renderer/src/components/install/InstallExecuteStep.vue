<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useInstallStore } from '@/stores/install';
import type { InstallStepId } from '@shared/domain/install';

// 执行安装步骤：展示流水线进度、实时日志与结果操作。
defineProps<{ instanceName: string }>();

const emit = defineEmits<{
  close: [];
  finish: [];
}>();

const STEP_LABELS: Record<InstallStepId, string> = {
  'install-mofox': '安装 MoFox',
  'install-platform': '安装平台',
  'install-webui': '安装 WebUI',
  configure: '配置',
  finalize: '完成',
};

const installStore = useInstallStore();
const progress = computed(() => installStore.progress);
const progressPercent = computed(() => {
  const p = progress.value;
  if (!p || p.progress < 0) return 0;
  return Math.round(p.progress * 100);
});
const isIndeterminate = computed(() => !progress.value || progress.value.progress < 0);
const stepLabel = computed(() => {
  const p = progress.value;
  return p ? STEP_LABELS[p.step] : '准备中...';
});

const logOpen = ref(true);
const logRef = ref<HTMLDivElement | null>(null);

watch(
  () => installStore.logLines.length,
  async () => {
    await nextTick();
    const el = logRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

async function retry(): Promise<void> {
  await installStore.retry();
}

async function cancel(): Promise<void> {
  await installStore.cancel();
  emit('close');
}
</script>

<template>
  <section class="step">
    <div class="step-header">
      <h1>正在安装{{ instanceName ? ` ${instanceName}` : '' }}</h1>
      <p>
        第 {{ (progress?.stepIndex ?? 0) + 1 }} / {{ progress?.stepCount ?? 1 }} 步 ·
        {{ stepLabel }}
      </p>
    </div>

    <div class="install-progress-bar">
      <div
        class="progress-fill"
        :class="{ 'progress-fill--indeterminate': isIndeterminate }"
        :style="isIndeterminate ? undefined : { width: `${progressPercent}%` }"
      ></div>
    </div>
    <div class="progress-info">
      <span>{{ stepLabel }}</span>
      <span>{{ progressPercent }}%</span>
    </div>

    <div class="install-log" :class="{ collapsed: !logOpen }">
      <div class="log-header">
        <span>安装日志</span>
        <button type="button" class="log-toggle state-layer" @click="logOpen = !logOpen">
          <span class="msr" aria-hidden="true">{{ logOpen ? 'expand_less' : 'expand_more' }}</span>
        </button>
      </div>
      <div ref="logRef" class="log-content">
        <p v-for="(line, idx) in installStore.logLines" :key="idx" class="log-line">{{ line }}</p>
      </div>
    </div>

    <div class="install-result">
      <template v-if="installStore.isFailed">
        <span class="msr result-icon result-icon--error" aria-hidden="true">error</span>
        <div class="result-actions">
          <button type="button" class="btn btn--tonal state-layer" @click="cancel">取消</button>
          <button type="button" class="btn btn--filled state-layer" @click="retry">重试</button>
        </div>
      </template>
      <template v-else-if="installStore.isDone">
        <span class="msr result-icon result-icon--success" aria-hidden="true">celebration</span>
        <h2>安装完成！</h2>
        <p>Neo-MoFox 已成功安装，你可以开始使用了。</p>
        <button type="button" class="btn btn--filled state-layer" @click="emit('finish')">
          查看实例
        </button>
      </template>
      <template v-else>
        <div class="result-actions">
          <button type="button" class="btn btn--text state-layer" @click="cancel">停止安装</button>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.install-progress-bar {
  height: 8px;
  background: var(--md-sys-color-surface-variant);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--md-sys-color-primary), var(--md-sys-color-tertiary));
  width: 0%;
  transition: width 0.5s;
  position: relative;
}

.progress-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transform: translateX(-100%);
  animation: install-shimmer 2s infinite;
}

.progress-fill--indeterminate {
  width: 40%;
  animation: install-indeterminate 1.4s linear infinite;
}

@keyframes install-indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

@keyframes install-shimmer {
  to {
    transform: translateX(100%);
  }
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 24px;
  color: var(--md-sys-color-on-surface);
}

.install-log {
  background: #111;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--md-sys-color-outline-variant);
  margin-bottom: 24px;
}

.install-log.collapsed .log-content {
  display: none;
}

.log-header {
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface);
}

.log-toggle {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: all 0.2s;
}

.log-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
}

.log-content {
  max-height: 200px;
  padding: 16px;
  font-family: var(--md-ref-typeface-mono);
  font-size: 13px;
  color: #a5d6a7;
  overflow-y: auto;
  white-space: pre-wrap;
}

.log-line {
  margin: 0 0 4px;
}

.install-result {
  padding: 24px 0;
  text-align: center;
}

.install-result h2 {
  font-size: 24px;
  margin: 8px 0;
  color: var(--md-sys-color-on-surface);
}

.install-result p {
  font-size: 14px;
  color: var(--md-sys-color-on-surface-variant);
  margin-bottom: 20px;
}

.result-icon {
  font-size: 64px;
}

.result-icon--success {
  color: var(--md-sys-color-tertiary);
}

.result-icon--error {
  color: var(--md-sys-color-error);
}

.result-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .progress-fill,
  .progress-fill--indeterminate {
    animation: none;
    transition: none;
  }
}
</style>
