<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useInstallDraftStore } from '@/stores/install-draft';
import { useInstallStore } from '@/stores/install';
import type { InstallRequest } from '@shared/domain/install';
import InstallLicenseStep from './InstallLicenseStep.vue';
import InstallInstanceStep from './InstallInstanceStep.vue';
import InstallApiKeyStep from './InstallApiKeyStep.vue';
import InstallPlatformStep from './InstallPlatformStep.vue';
import InstallWebuiStep from './InstallWebuiStep.vue';
import InstallLocationStep from './InstallLocationStep.vue';
import InstallSummaryStep from './InstallSummaryStep.vue';
import InstallExecuteStep from './InstallExecuteStep.vue';
import '@/components/install/install-wizard.css';

// 安装向导主组件：负责左侧步骤导航、各步骤组件的调用编排与前进/回退控制。
const STEPS = [
  { id: 'license', title: '许可协议' },
  { id: 'instance', title: '实例信息' },
  { id: 'apiKey', title: '模型配置' },
  { id: 'network', title: '网络配置' },
  { id: 'webui', title: '组件选择' },
  { id: 'location', title: '安装位置' },
  { id: 'summary', title: '确认摘要' },
  { id: 'execute', title: '执行安装' },
] as const;

const draftStore = useInstallDraftStore();
const installStore = useInstallStore();

const emit = defineEmits<{
  close: [];
  complete: [];
}>();

const currentStep = ref(1);
const stepDirection = ref<'forward' | 'backward'>('forward');
const licenseAgreed = ref(false);

// 恢复后台安装时直接回到执行页。
onMounted(() => {
  if (installStore.isInstalling) {
    currentStep.value = STEPS.length;
  }
});

const canGoNext = computed(() => {
  switch (currentStep.value) {
    case 1:
      return licenseAgreed.value;
    case 2:
      return (
        draftStore.fieldErrors.instanceName === '' &&
        draftStore.fieldErrors.botQQ === '' &&
        draftStore.fieldErrors.ownerQQ === ''
      );
    case 3:
      return draftStore.fieldErrors.apiKey === '';
    case 4:
      return draftStore.fieldErrors.wsPort === '';
    case 5:
      return draftStore.fieldErrors.webuiKey === '';
    case 6:
      return draftStore.fieldErrors.targetDir === '';
    case 7:
      return draftStore.allValid;
    default:
      return false;
  }
});

function goNext(): void {
  if (!canGoNext.value) return;
  if (currentStep.value === STEPS.length - 1) {
    void startInstall();
    return;
  }
  stepDirection.value = 'forward';
  currentStep.value += 1;
}

function goPrev(): void {
  if (currentStep.value <= 1 || currentStep.value >= STEPS.length) return;
  stepDirection.value = 'backward';
  currentStep.value -= 1;
}

function goToStep(step: number): void {
  if (step >= currentStep.value || currentStep.value >= STEPS.length) return;
  stepDirection.value = 'backward';
  currentStep.value = step;
}

async function startInstall(): Promise<void> {
  const request: InstallRequest = { ...draftStore.draft };
  stepDirection.value = 'forward';
  currentStep.value = STEPS.length;
  await installStore.begin(request);
}

async function cancelInstall(): Promise<void> {
  await installStore.cancel();
  emit('close');
}

function leave(): void {
  emit('close');
}

function goToInstances(): void {
  emit('complete');
}
</script>

<template>
  <div class="wizard">
    <aside class="wizard__rail">
      <ol class="stepper">
        <li
          v-for="(step, idx) in STEPS"
          :key="step.id"
          class="stepper__item"
          :class="{
            'stepper__item--done': idx + 1 < currentStep,
            'stepper__item--current': idx + 1 === currentStep,
          }"
        >
          <button
            type="button"
            class="stepper__marker state-layer"
            :disabled="idx + 1 >= currentStep"
            @click="goToStep(idx + 1)"
          >
            <span v-if="idx + 1 < currentStep" class="msr msr--fill" aria-hidden="true">check</span>
            <span v-else>{{ idx + 1 }}</span>
          </button>
          <span class="stepper__title">{{ step.title }}</span>
          <span v-if="idx < STEPS.length - 1" class="stepper__line"></span>
        </li>
      </ol>

      <!-- 返回/取消按钮固定在侧栏左下角，每个步骤都可停止安装并返回主菜单 -->
      <div class="wizard__rail-back">
        <button
          v-if="currentStep === 1"
          type="button"
          class="btn btn--tonal state-layer"
          @click="cancelInstall"
        >
          取消
        </button>
        <template v-else>
          <button type="button" class="btn btn--text state-layer" @click="cancelInstall">
            取消
          </button>
          <button
            v-if="currentStep < STEPS.length"
            type="button"
            class="btn btn--tonal state-layer"
            :disabled="installStore.isInstalling"
            @click="goPrev"
          >
            上一步
          </button>
        </template>
      </div>
    </aside>

    <div class="wizard__panel">
      <transition :name="`wizard-slide-${stepDirection}`" mode="out-in">
        <div :key="currentStep" class="wizard__content">
          <InstallLicenseStep v-if="currentStep === 1" v-model:agreed="licenseAgreed" />
          <InstallInstanceStep v-else-if="currentStep === 2" />
          <InstallApiKeyStep v-else-if="currentStep === 3" />
          <InstallPlatformStep v-else-if="currentStep === 4" />
          <InstallWebuiStep v-else-if="currentStep === 5" />
          <InstallLocationStep v-else-if="currentStep === 6" />
          <InstallSummaryStep v-else-if="currentStep === 7" />
          <InstallExecuteStep
            v-else
            :instance-name="draftStore.draft.instanceName"
            @close="leave"
            @finish="goToInstances"
          />
        </div>
      </transition>

      <!-- 前进/开始安装按钮固定在面板右下角 -->
      <div v-if="currentStep < STEPS.length" class="wizard__nav">
        <span class="wizard__nav-spacer"></span>
        <button
          v-if="currentStep < STEPS.length - 1"
          type="button"
          class="btn btn--filled state-layer"
          :disabled="!canGoNext"
          @click="goNext"
        >
          下一步
        </button>
        <button
          v-else-if="currentStep === STEPS.length - 1"
          type="button"
          class="btn btn--filled state-layer btn--large"
          :disabled="!canGoNext"
          @click="goNext"
        >
          <span class="msr" aria-hidden="true">rocket_launch</span>
          开始安装
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard {
  display: flex;
  height: 100%;
  min-height: 0;
}

.wizard__rail {
  width: 260px;
  flex: 0 0 260px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 40px 24px 28px;
  border-right: 1px solid var(--app-glass-border);
  background: var(--app-subrail-surface);
  backdrop-filter: var(--app-subrail-filter);
  -webkit-backdrop-filter: var(--app-subrail-filter);
}

.stepper {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}

/* 返回/取消按钮固定在侧栏左下角 */
.wizard__rail-back {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  margin-top: auto;
  padding-top: 24px;
}

.stepper__item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 32px;
}

.stepper__item:last-child {
  padding-bottom: 0;
}

.stepper__marker {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: grid;
  place-items: center;
  font: var(--md-sys-typescale-label-large);
  cursor: default;
  z-index: 1;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.stepper__marker .msr {
  font-size: 18px;
}

.stepper__item--current .stepper__marker {
  border: 2px solid var(--md-sys-color-primary);
  color: var(--md-sys-color-primary);
}

.stepper__item--done .stepper__marker {
  border-color: transparent;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  cursor: pointer;
}

.stepper__title {
  font: var(--md-sys-typescale-title-small);
  color: var(--md-sys-color-on-surface-variant);
  padding-top: 6px;
}

.stepper__item--current .stepper__title {
  color: var(--md-sys-color-on-surface);
}

.stepper__line {
  position: absolute;
  left: 15px;
  top: 32px;
  bottom: 0;
  width: 2px;
  background: var(--md-sys-color-outline-variant);
}

.stepper__item--done .stepper__line {
  background: var(--md-sys-color-primary);
}

.wizard__panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 40px 48px;
  background: var(--app-current-content-surface);
  backdrop-filter: var(--app-current-content-filter);
  -webkit-backdrop-filter: var(--app-current-content-filter);
  overflow: hidden;
}

/* 步骤内容水平居中，按钮固定在面板底部（右下角） */
.wizard__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  width: min(100%, 560px);
  margin: 0 auto;
}

.wizard__nav {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
  padding-top: 24px;
}

.wizard__nav-spacer {
  flex: 1;
}

.wizard-slide-forward-enter-active,
.wizard-slide-forward-leave-active,
.wizard-slide-backward-enter-active,
.wizard-slide-backward-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized);
}

.wizard-slide-forward-enter-from,
.wizard-slide-backward-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.wizard-slide-forward-leave-to,
.wizard-slide-backward-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}

@media (prefers-reduced-motion: reduce) {
  .wizard-slide-forward-enter-active,
  .wizard-slide-forward-leave-active,
  .wizard-slide-backward-enter-active,
  .wizard-slide-backward-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .wizard-slide-forward-enter-from,
  .wizard-slide-forward-leave-to,
  .wizard-slide-backward-enter-from,
  .wizard-slide-backward-leave-to {
    transform: none;
  }
}

@media (max-width: 720px) {
  .wizard {
    flex-direction: column;
  }

  .wizard__rail {
    width: 100%;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
    border-right: none;
    border-bottom: 1px solid var(--app-glass-border);
  }

  .stepper {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow-x: auto;
    gap: 16px;
  }

  .wizard__rail-back {
    flex: 0 0 auto;
    margin-top: 0;
    padding-top: 0;
    padding-left: 12px;
    border-left: 1px solid var(--app-glass-border);
  }

  .stepper__item {
    flex: 0 0 auto;
    align-items: center;
    padding: 0;
  }

  .stepper__title {
    padding-top: 0;
  }

  .stepper__line {
    display: none;
  }

  .wizard__panel {
    padding: 24px 20px;
  }
}
</style>
