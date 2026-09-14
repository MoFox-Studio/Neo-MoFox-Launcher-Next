<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useInstallStore } from '@/stores/install';
import type { InstallStepId } from '@shared/domain/install';

const props = defineProps<{ instanceName: string }>();

const emit = defineEmits<{
  cancel: [];
  finish: [];
}>();

const STEPS: { id: InstallStepId; label: string; description: string; icon: string }[] = [
  { id: 'install-mofox', label: 'Neo-MoFox', description: '获取主程序与 Python 依赖', icon: 'smart_toy' },
  { id: 'install-platform', label: '机器人平台', description: '安装并连接所选适配器', icon: 'hub' },
  { id: 'install-webui', label: 'WebUI', description: '准备可视化管理组件', icon: 'dashboard' },
  { id: 'configure', label: '写入配置', description: '应用账号、模型与网络设置', icon: 'tune' },
  { id: 'finalize', label: '完成登记', description: '验证文件并创建实例记录', icon: 'verified' },
];

const installStore = useInstallStore();
const progress = computed(() => installStore.progress);
const logOpen = ref(false);
const retrying = ref(false);
const logRef = ref<HTMLDivElement | null>(null);

const currentStepIndex = computed(() => progress.value?.stepIndex ?? 0);
const currentStep = computed(() => STEPS.find((step) => step.id === progress.value?.step));
const currentStepLabel = computed(() => currentStep.value?.label ?? '准备安装');
const latestMessage = computed(
  () => progress.value?.message || installStore.logLines.at(-1) || '正在创建安装任务…',
);

const overallPercent = computed(() => {
  const current = progress.value;
  if (installStore.isDone) return 100;
  if (!current || current.stepCount <= 0) return 0;
  const localProgress = current.progress < 0 ? 0 : current.progress;
  return Math.max(
    0,
    Math.min(99, Math.round(((current.stepIndex + localProgress) / current.stepCount) * 100)),
  );
});

const isIndeterminate = computed(
  () => !progress.value || (progress.value.progress < 0 && !installStore.isFailed),
);

function stepState(index: number): 'done' | 'active' | 'error' | 'upcoming' {
  if (installStore.isDone) return 'done';
  if (index < currentStepIndex.value) return 'done';
  if (index > currentStepIndex.value) return 'upcoming';
  return installStore.isFailed ? 'error' : 'active';
}

watch(
  () => installStore.logLines.length,
  async () => {
    if (!logOpen.value) return;
    await nextTick();
    if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
  },
);

watch(logOpen, async (open) => {
  if (!open) return;
  await nextTick();
  if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
});

async function retry(): Promise<void> {
  retrying.value = true;
  try {
    await installStore.retry();
  } finally {
    retrying.value = false;
  }
}
</script>

<template>
  <section class="execute-step">
    <div v-if="installStore.isDone" class="result-state result-state--success">
      <span class="result-state__mark" aria-hidden="true">
        <span class="msr msr--fill">check_circle</span>
      </span>
      <div class="result-state__copy">
        <p class="result-state__eyebrow">安装完成</p>
        <h2>{{ props.instanceName || 'Neo-MoFox' }} 已准备就绪</h2>
        <p>主程序、所选组件与实例配置均已完成，现在可以前往实例页启动它。</p>
      </div>
      <div class="result-state__facts">
        <span><span class="msr" aria-hidden="true">verified</span> 5 个阶段已完成</span>
        <span><span class="msr" aria-hidden="true">folder</span> 实例已登记</span>
      </div>
      <button type="button" class="btn btn--filled btn--large state-layer" @click="emit('finish')">
        查看实例
        <span class="msr" aria-hidden="true">arrow_forward</span>
      </button>
      <button type="button" class="log-disclosure state-layer" @click="logOpen = !logOpen">
        <span class="msr" aria-hidden="true">terminal</span>
        {{ logOpen ? '收起安装记录' : '查看安装记录' }}
        <span class="msr log-disclosure__arrow" :class="{ 'is-open': logOpen }" aria-hidden="true">
          expand_more
        </span>
      </button>
    </div>

    <div v-else-if="installStore.isFailed" class="result-state result-state--error">
      <span class="result-state__mark" aria-hidden="true">
        <span class="msr msr--fill">error</span>
      </span>
      <div class="result-state__copy">
        <p class="result-state__eyebrow">{{ currentStepLabel }} 未完成</p>
        <h2>安装在第 {{ currentStepIndex + 1 }} 步停下了</h2>
        <p>已完成的步骤会保留；重试时将从当前失败步骤继续，不必重新下载全部内容。</p>
      </div>

      <div class="error-message-card" role="alert">
        <span class="msr" aria-hidden="true">report</span>
        <div>
          <strong>失败原因</strong>
          <p>{{ latestMessage }}</p>
        </div>
      </div>

      <ul class="recovery-list">
        <li><span class="msr" aria-hidden="true">wifi</span>确认网络、代理或镜像源当前可用</li>
        <li><span class="msr" aria-hidden="true">folder_open</span>确认安装目录仍可写且空间充足</li>
      </ul>

      <div class="result-state__actions">
        <button type="button" class="btn btn--text state-layer" @click="emit('cancel')">取消任务</button>
        <button
          type="button"
          class="btn btn--filled state-layer"
          :disabled="retrying"
          @click="retry"
        >
          <span v-if="retrying" class="spinner spinner--small" aria-hidden="true"></span>
          <span v-else class="msr" aria-hidden="true">refresh</span>
          {{ retrying ? '正在重试' : `从「${currentStepLabel}」重试` }}
        </button>
      </div>

      <button type="button" class="log-disclosure state-layer" @click="logOpen = !logOpen">
        <span class="msr" aria-hidden="true">terminal</span>
        {{ logOpen ? '收起技术详情' : '展开技术详情' }}
        <span class="msr log-disclosure__arrow" :class="{ 'is-open': logOpen }" aria-hidden="true">
          expand_more
        </span>
      </button>
    </div>

    <template v-else>
      <div class="progress-overview">
        <div class="progress-overview__copy">
          <div>
            <p class="progress-overview__eyebrow">
              第 {{ currentStepIndex + 1 }} / {{ progress?.stepCount ?? STEPS.length }} 步
            </p>
            <h2>{{ currentStepLabel }}</h2>
          </div>
          <span class="progress-overview__value">{{ overallPercent }}%</span>
        </div>
        <div class="progress-track" role="progressbar" :aria-valuenow="overallPercent">
          <div
            class="progress-track__bar"
            :class="{ 'progress-track__bar--indeterminate': isIndeterminate }"
            :style="isIndeterminate ? undefined : { width: `${overallPercent}%` }"
          ></div>
        </div>
        <p class="progress-overview__message">{{ latestMessage }}</p>
      </div>

      <div class="pipeline" aria-label="安装阶段">
        <div
          v-for="(step, index) in STEPS"
          :key="step.id"
          class="pipeline__step"
          :class="`pipeline__step--${stepState(index)}`"
        >
          <span class="pipeline__mark" aria-hidden="true">
            <span class="msr" :class="{ 'msr--fill': stepState(index) === 'done' }">
              {{
                stepState(index) === 'done'
                  ? 'check'
                  : stepState(index) === 'error'
                    ? 'close'
                    : step.icon
              }}
            </span>
          </span>
          <span class="pipeline__copy">
            <strong>{{ step.label }}</strong>
            <span>{{ step.description }}</span>
          </span>
          <span class="pipeline__status">
            {{
              stepState(index) === 'done'
                ? '完成'
                : stepState(index) === 'active'
                  ? '进行中'
                  : '等待'
            }}
          </span>
        </div>
      </div>

      <div class="execute-step__actions">
        <button type="button" class="log-disclosure state-layer" @click="logOpen = !logOpen">
          <span class="msr" aria-hidden="true">terminal</span>
          {{ logOpen ? '收起安装日志' : `安装日志 · ${installStore.logLines.length}` }}
          <span class="msr log-disclosure__arrow" :class="{ 'is-open': logOpen }" aria-hidden="true">
            expand_more
          </span>
        </button>
        <button type="button" class="btn btn--text state-layer" @click="emit('cancel')">
          取消安装
        </button>
      </div>
    </template>

    <div class="log-sheet" :class="{ 'log-sheet--open': logOpen }">
      <div class="log-sheet__clip">
        <div ref="logRef" class="log-sheet__content">
          <p v-if="installStore.logLines.length === 0" class="log-line log-line--empty">
            暂无日志，正在等待任务输出…
          </p>
          <p v-for="(line, index) in installStore.logLines" :key="index" class="log-line">
            {{ line }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.execute-step {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.progress-overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 20px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.progress-overview__copy {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.progress-overview__eyebrow,
.progress-overview h2,
.progress-overview__message {
  margin: 0;
}

.progress-overview__eyebrow {
  font: var(--md-sys-typescale-label-medium);
  opacity: 0.75;
}

.progress-overview h2 {
  margin-top: 2px;
  font: var(--md-sys-typescale-title-large);
}

.progress-overview__value {
  font: var(--md-sys-typescale-headline-small);
}

.progress-overview__message {
  min-height: 20px;
  overflow: hidden;
  font: var(--md-sys-typescale-body-medium);
  opacity: 0.88;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress-track {
  height: 8px;
  overflow: hidden;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-on-primary-container) 16%, transparent);
}

.progress-track__bar {
  height: 100%;
  border-radius: inherit;
  background: var(--md-sys-color-primary);
  transition: width var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

.progress-track__bar--indeterminate {
  width: 38%;
  animation: progress-scan 1.3s linear infinite;
}

@keyframes progress-scan {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(275%);
  }
}

.pipeline {
  display: grid;
  gap: 3px;
}

.pipeline__step {
  min-height: 58px;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-radius: 6px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
}

.pipeline__step:first-child {
  border-radius: 17px 17px 6px 6px;
}

.pipeline__step:last-child {
  border-radius: 6px 6px 17px 17px;
}

.pipeline__step--active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.pipeline__step--done {
  color: var(--md-sys-color-on-surface);
}

.pipeline__step--error {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.pipeline__mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container-highest);
}

.pipeline__step--active .pipeline__mark,
.pipeline__step--done .pipeline__mark {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.pipeline__mark .msr {
  font-size: 20px;
}

.pipeline__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pipeline__copy strong {
  color: inherit;
  font: var(--md-sys-typescale-title-small);
}

.pipeline__copy span,
.pipeline__status {
  color: inherit;
  font: var(--md-sys-typescale-body-small);
  opacity: 0.76;
}

.pipeline__status {
  font-weight: 600;
}

.execute-step__actions,
.result-state__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.log-disclosure {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.log-disclosure .msr {
  font-size: 19px;
}

.log-disclosure__arrow {
  transition: transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.log-disclosure__arrow.is-open {
  transform: rotate(180deg);
}

.log-sheet {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard),
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.log-sheet--open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.log-sheet__clip {
  min-height: 0;
  overflow: hidden;
}

.log-sheet__content {
  max-height: 190px;
  padding: 14px 16px;
  overflow-y: auto;
  border-radius: 16px;
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  font-family: var(--md-ref-typeface-mono);
  font-size: 12px;
  line-height: 1.55;
  user-select: text;
}

.log-line {
  margin: 0 0 3px;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-line--empty {
  opacity: 0.65;
}

.result-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 18px 12px 6px;
  text-align: center;
}

.result-state__mark {
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
  border-radius: 25px;
}

.result-state__mark .msr {
  font-size: 42px;
}

.result-state--success .result-state__mark {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.result-state--error .result-state__mark {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.result-state__copy {
  max-width: 560px;
}

.result-state__eyebrow,
.result-state__copy h2,
.result-state__copy > p:last-child {
  margin: 0;
}

.result-state__eyebrow {
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
}

.result-state--error .result-state__eyebrow {
  color: var(--md-sys-color-error);
}

.result-state__copy h2 {
  margin-top: 4px;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-headline-small);
}

.result-state__copy > p:last-child {
  margin-top: 7px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.result-state__facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.result-state__facts > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
}

.result-state__facts .msr {
  font-size: 17px;
}

.error-message-card {
  width: min(100%, 620px);
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 17px;
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  text-align: left;
}

.error-message-card > .msr {
  flex: none;
}

.error-message-card strong,
.error-message-card p {
  margin: 0;
}

.error-message-card strong {
  font: var(--md-sys-typescale-title-small);
}

.error-message-card p {
  margin-top: 3px;
  font: var(--md-sys-typescale-body-medium);
  word-break: break-word;
}

.recovery-list {
  width: min(100%, 620px);
  display: grid;
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
  text-align: left;
}

.recovery-list li {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.recovery-list li:first-child {
  border-radius: 15px 15px 6px 6px;
}

.recovery-list li:last-child {
  border-radius: 6px 6px 15px 15px;
}

.recovery-list .msr {
  font-size: 20px;
}

@media (prefers-reduced-motion: reduce) {
  .progress-track__bar,
  .log-sheet,
  .log-disclosure__arrow {
    animation: none;
    transition-duration: var(--md-sys-motion-duration-short2);
  }
}

@media (max-width: 620px) {
  .pipeline__step {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .pipeline__status {
    display: none;
  }

  .execute-step__actions,
  .result-state__actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }
}
</style>
