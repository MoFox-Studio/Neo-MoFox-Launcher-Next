<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import OobeStepper from '@/components/oobe/OobeStepper.vue';
import OobeWelcome from '@/components/oobe/OobeWelcome.vue';
import OobeDependencyInstall from '@/components/oobe/OobeDependencyInstall.vue';
import OobeLegacyImport from '@/components/oobe/OobeLegacyImport.vue';
import OobePreferences from '@/components/oobe/OobePreferences.vue';
import OobeSummary from '@/components/oobe/OobeSummary.vue';
import { useSettingsStore } from '@/stores/settings';
import { useWindowTitle } from '@/composables/use-window-title';

type StepId = 'welcome' | 'dependencies' | 'legacy' | 'preferences' | 'summary';

interface Step {
  id: StepId;
  label: string;
  visible: boolean;
}

const settingsStore = useSettingsStore();
useWindowTitle({ title: '首次引导', subtitle: '完成启动器的初始配置' });

const showLegacyStep = ref(true);
const currentStepId = ref<StepId>('welcome');
const steps = computed<Step[]>(() => [
  { id: 'welcome', label: '欢迎', visible: true },
  { id: 'dependencies', label: '依赖', visible: true },
  { id: 'legacy', label: '导入', visible: showLegacyStep.value },
  { id: 'preferences', label: '偏好', visible: true },
  { id: 'summary', label: '完成', visible: true },
]);
const visibleSteps = computed(() => steps.value.filter((step) => step.visible));
const currentVisibleIndex = computed(() =>
  visibleSteps.value.findIndex((step) => step.id === currentStepId.value),
);
const progressLabel = computed(
  () => `${Math.max(1, currentVisibleIndex.value + 1)} / ${visibleSteps.value.length}`,
);

function goToStep(id: StepId, _direction: 'forward' | 'backward'): void {
  currentStepId.value = id;
}

function goNextVisible(): void {
  const index = currentVisibleIndex.value;
  if (index < 0 || index >= visibleSteps.value.length - 1) return;
  currentStepId.value = visibleSteps.value[index + 1].id;
}

function skipLegacyStep(): void {
  showLegacyStep.value = false;
  currentStepId.value = 'preferences';
}

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.load();
});
</script>

<template>
  <div class="oobe">
    <section class="oobe__surface">
      <header class="oobe__header">
        <div class="oobe__identity">
          <span class="oobe__mark" aria-hidden="true"><span class="msr msr--fill">pets</span></span>
          <div>
            <h1>启动器初始设置</h1>
            <p>完成一次设置，之后所有选项仍可修改。</p>
          </div>
          <span class="oobe__progress-label">{{ progressLabel }}</span>
        </div>
        <OobeStepper :steps="steps" :current="currentVisibleIndex + 1" />
      </header>

      <div class="oobe__stage">
        <div class="oobe__content">
          <OobeWelcome
            v-if="currentStepId === 'welcome'"
            @next="goToStep('dependencies', 'forward')"
          />

          <OobeDependencyInstall
            v-else-if="currentStepId === 'dependencies'"
            @next="goNextVisible()"
            @back="goToStep('welcome', 'backward')"
            @skip="goNextVisible()"
          />

          <OobeLegacyImport
            v-else-if="currentStepId === 'legacy'"
            @next="goToStep('preferences', 'forward')"
            @skip="skipLegacyStep()"
          />

          <OobePreferences
            v-else-if="currentStepId === 'preferences'"
            @next="goToStep('summary', 'forward')"
            @back="
              showLegacyStep ? goToStep('legacy', 'backward') : goToStep('dependencies', 'backward')
            "
          />

          <OobeSummary v-else />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.oobe {
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 28px;
  overflow: hidden;
  background: var(--md-sys-color-surface);
}

.oobe__surface {
  width: min(100%, 860px);
  height: min(100%, 740px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-card-filter);
  -webkit-backdrop-filter: var(--app-glass-card-filter);
}

.oobe__header {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 24px 16px;
}

.oobe__identity {
  min-width: 0;
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}

.oobe__mark {
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  border-radius: 17px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.oobe__mark .msr {
  font-size: 28px;
}

.oobe__identity h1,
.oobe__identity p {
  margin: 0;
}

.oobe__identity h1 {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-large);
}

.oobe__identity p {
  margin-top: 2px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.oobe__progress-label {
  padding: 5px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-medium);
}

.oobe__stage {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 12px 32px 28px;
}

.oobe__content {
  min-height: 100%;
  display: flex;
  align-items: center;
}

.oobe__content > :deep(.oobe-step) {
  width: 100%;
  display: flex;
  flex-direction: column;
}

@media (max-height: 680px) {
  .oobe {
    align-items: stretch;
    padding-block: 12px;
  }

  .oobe__surface {
    height: 100%;
  }

  .oobe__content {
    align-items: flex-start;
  }
}

@media (max-width: 620px) {
  .oobe {
    padding: 10px;
  }

  .oobe__surface {
    height: 100%;
    border-radius: 22px;
  }

  .oobe__header {
    padding: 16px 16px 12px;
  }

  .oobe__identity p {
    display: none;
  }

  .oobe__stage {
    padding: 10px 20px 22px;
  }
}
</style>
