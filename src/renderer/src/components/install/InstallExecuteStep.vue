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
  return p ? STEP_LABELS[p.step] : '准备';
});

const logPanelOpen = ref(true);
const logPanelRef = ref<HTMLDivElement | null>(null);

watch(
  () => installStore.logLines.length,
  async () => {
    await nextTick();
    const el = logPanelRef.value;
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
  <section class="step step--execute">
    <h2 class="step__title">正在安装{{ instanceName ? ` ${instanceName}` : '' }}</h2>
    <p class="step__step-label">
      第 {{ (progress?.stepIndex ?? 0) + 1 }} / {{ progress?.stepCount ?? 1 }} 步 · {{ stepLabel }}
    </p>

    <div class="progress-track">
      <div
        class="progress-track__bar"
        :class="{ 'progress-track__bar--indeterminate': isIndeterminate }"
        :style="isIndeterminate ? undefined : { transform: `scaleX(${progressPercent / 100})` }"
      ></div>
    </div>

    <div class="log-panel">
      <button
        type="button"
        class="log-panel__toggle state-layer"
        @click="logPanelOpen = !logPanelOpen"
      >
        <span class="msr" aria-hidden="true">{{
          logPanelOpen ? 'expand_less' : 'expand_more'
        }}</span>
        安装日志
      </button>
      <div v-show="logPanelOpen" class="log-panel__body">
        <div ref="logPanelRef" class="log-panel__scroll">
          <p v-for="(line, idx) in installStore.logLines" :key="idx" class="log-panel__line">
            {{ line }}
          </p>
        </div>
      </div>
    </div>

    <div class="execute-actions">
      <template v-if="installStore.isFailed">
        <button type="button" class="btn btn--text state-layer" @click="cancel">取消</button>
        <button type="button" class="btn btn--filled state-layer" @click="retry">重试</button>
      </template>
      <template v-else-if="installStore.isDone">
        <span class="msr msr--fill execute-actions__done-icon" aria-hidden="true"
          >check_circle</span
        >
        <button type="button" class="btn btn--filled state-layer" @click="emit('finish')">
          查看实例
        </button>
      </template>
      <template v-else>
        <button type="button" class="btn btn--text state-layer" @click="cancel">停止安装</button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.step__step-label {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 20px;
}

.progress-track {
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  overflow: hidden;
  position: relative;
  margin-bottom: 24px;
}

.progress-track__bar {
  width: 100%;
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

.progress-track__bar--indeterminate {
  width: 40%;
  position: absolute;
  transform: translateX(-100%);
  transform-origin: center;
  animation: install-progress-indeterminate 1.4s linear infinite;
  transition: none;
}

@keyframes install-progress-indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

.log-panel {
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  overflow: hidden;
  margin-bottom: 24px;
}

.log-panel__toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border: none;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.log-panel__body {
  max-height: 240px;
  overflow-y: auto;
  background: var(--md-sys-color-surface-container-highest);
  padding: 12px 16px;
}

.log-panel__scroll {
  min-height: 0;
}

.log-panel__line {
  margin: 0 0 4px;
  font-family: var(--md-ref-typeface-mono);
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--md-sys-color-on-surface-variant);
}

.execute-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.execute-actions__done-icon {
  color: var(--md-sys-color-tertiary);
  font-size: 28px;
}

@media (prefers-reduced-motion: reduce) {
  .progress-track__bar--indeterminate {
    animation: none;
    transform: none;
  }
}
</style>
