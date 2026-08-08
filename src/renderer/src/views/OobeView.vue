<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import OobeStepper from '@/components/oobe/OobeStepper.vue';
import OobeWelcome from '@/components/oobe/OobeWelcome.vue';
import OobeDependencyInstall from '@/components/oobe/OobeDependencyInstall.vue';
import OobeLegacyImport from '@/components/oobe/OobeLegacyImport.vue';
import OobePreferences from '@/components/oobe/OobePreferences.vue';
import OobeSummary from '@/components/oobe/OobeSummary.vue';
import { useSettingsStore } from '@/stores/settings';

// 首次引导编排：欢迎 → 依赖安装（仅 Linux 在确认安装后索取 sudo 密码）→ 旧版导入（仅检测到时）→ 偏好设置 → 总结
type StepId = 'welcome' | 'dependencies' | 'legacy' | 'preferences' | 'summary';

interface Step {
  id: StepId;
  label: string;
  visible: boolean;
}

const settingsStore = useSettingsStore();

const steps = computed<Step[]>(() => [
  { id: 'welcome', label: '欢迎', visible: true },
  { id: 'dependencies', label: '依赖', visible: true },
  { id: 'legacy', label: '导入', visible: showLegacyStep.value },
  { id: 'preferences', label: '偏好', visible: true },
  { id: 'summary', label: '总结', visible: true },
]);

const showLegacyStep = ref(true);

// 当前步骤索引（基于全部 StepId，不跳过隐藏步骤）；导航时根据 visible 决定是否停留。
const currentStepId = ref<StepId>('welcome');

const visibleSteps = computed(() => steps.value.filter((s) => s.visible));
const currentVisibleIndex = computed(() =>
  visibleSteps.value.findIndex((s) => s.id === currentStepId.value),
);

function goToStep(id: StepId): void {
  currentStepId.value = id;
}

function goNextVisible(): void {
  const idx = currentVisibleIndex.value;
  if (idx < 0 || idx >= visibleSteps.value.length - 1) return;
  currentStepId.value = visibleSteps.value[idx + 1].id;
}

function skipLegacyStep(): void {
  // 先解除对 legacy 的停留再隐藏，否则 currentStepId 仍指向 legacy，
  // goNextVisible 会因 findIndex 返回 -1 而中止，导致用户卡在已隐藏的步骤上。
  showLegacyStep.value = false;
  goToStep('preferences');
}

onMounted(async () => {
  if (!settingsStore.loaded) {
    await settingsStore.load();
  }
});
</script>

<template>
  <div class="oobe">
    <OobeStepper :steps="steps" :current="currentVisibleIndex + 1" />

    <div class="oobe__stage">
      <transition name="oobe-slide" mode="out-in">
        <OobeWelcome v-if="currentStepId === 'welcome'" key="welcome" @next="goToStep('dependencies')" />

        <OobeDependencyInstall
          v-else-if="currentStepId === 'dependencies'"
          key="dependencies"
          @next="goNextVisible()"
          @back="goToStep('welcome')"
          @skip="goNextVisible()"
        />

        <OobeLegacyImport
          v-else-if="currentStepId === 'legacy'"
          key="legacy"
          @next="goToStep('preferences')"
          @skip="skipLegacyStep()"
        />

        <OobePreferences
          v-else-if="currentStepId === 'preferences'"
          key="preferences"
          @next="goToStep('summary')"
          @back="showLegacyStep ? goToStep('legacy') : goToStep('dependencies')"
        />

        <OobeSummary v-else key="summary" />
      </transition>
    </div>
  </div>
</template>

<style scoped>
.oobe {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--md-sys-color-surface);
  padding: clamp(24px, 5vh, 56px) clamp(24px, 6vw, 96px);
  overflow-y: auto;
}

.oobe__stage {
  width: min(100%, 720px);
  flex: 1;
  display: flex;
  align-items: center;
}

@media (max-height: 720px) {
  .oobe__stage {
    align-items: flex-start;
    padding-top: 24px;
  }
}

.oobe__stage > :deep(.oobe-step) {
  width: 100%;
  display: flex;
  flex-direction: column;
}

/* 步骤切换动画 */
.oobe-slide-enter-active,
.oobe-slide-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized);
}

.oobe-slide-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.oobe-slide-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

@media (prefers-reduced-motion: reduce) {
  .oobe-slide-enter-active,
  .oobe-slide-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .oobe-slide-enter-from,
  .oobe-slide-leave-to {
    transform: none;
  }
}

@media (max-width: 640px) {
  .oobe {
    padding-inline: 20px;
  }
}
</style>
