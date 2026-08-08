<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useOobeStore } from '@/stores/oobe';
import { useSettingsStore } from '@/stores/settings';
import type { OobeCompletionSummary, OobeDependencyStatus } from '@shared/domain/oobe';
import { MofoxError } from '@shared/domain/error';

const router = useRouter();
const oobe = useOobeStore();
const settingsStore = useSettingsStore();

const summary = ref<OobeCompletionSummary | null>(null);
const completing = ref(false);
const errorMessage = ref<string | null>(null);

function describeError(error: unknown): string {
  if (error instanceof MofoxError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}

async function finish(): Promise<void> {
  completing.value = true;
  errorMessage.value = null;
  try {
    summary.value = await oobe.complete();
    // 同步设置仓库以反映 oobeCompleted=true。
    await settingsStore.load();
    // 完成后直接进入主界面。
    await router.replace({ name: 'dashboard' });
  } catch (error) {
    errorMessage.value = describeError(error);
  } finally {
    completing.value = false;
  }
}

// 从依赖安装步骤的状态快照先填一份显示，完成后再替换为后端结果。
const dependencies = computed<OobeDependencyStatus[]>(() => {
  if (summary.value) return summary.value.dependencies;
  return oobe.dependencies;
});

const legacyDetected = computed(() => Boolean(summary.value?.legacy));

// 暴露给模板使用
defineExpose({ finish });
</script>

<template>
  <section class="oobe-step oobe-step--summary">
    <div class="summary-hero">
      <span class="msr msr--fill summary-hero__icon" aria-hidden="true">verified</span>
    </div>
    <h2 class="oobe__title">配置完成</h2>
    <p class="oobe__intro">Neo-MoFox 已就绪，可以开始安装并管理机器人实例了。</p>

    <ul class="summary-list">
      <li v-for="dep in dependencies" :key="dep.id" class="summary-list__item">
        <span class="msr summary-list__icon" aria-hidden="true">{{ dep.status === 'failed' ? 'error' : 'check_circle' }}</span>
        <span class="summary-list__name">{{ dep.displayName }}</span>
        <span class="summary-list__value">
          <template v-if="dep.version">{{ dep.version }}</template>
          <template v-else>失败</template>
        </span>
      </li>
    </ul>

    <div v-if="legacyDetected" class="summary-banner">
      <span class="msr summary-banner__icon" aria-hidden="true">folder_special</span>
      <span>检测到旧版启动器数据目录，可在「设置 → 数据迁移」中再次执行导入。</span>
    </div>

    <div v-if="errorMessage" class="summary-error">
      <span class="msr summary-error__icon" aria-hidden="true">error</span>
      <span>{{ errorMessage }}</span>
    </div>

    <div class="summary-actions">
      <button
        type="button"
        class="btn btn--filled btn--large state-layer"
        :disabled="completing"
        @click="finish"
      >
        <span v-if="completing" class="spinner spinner--small" aria-hidden="true"></span>
        完成安装
      </button>
    </div>
  </section>
</template>

<style scoped>
.oobe-step--summary {
  align-items: center;
  text-align: center;
}

.summary-hero {
  width: 120px;
  height: 120px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary-container);
  display: grid;
  place-items: center;
  margin-bottom: 24px;
}

.summary-hero__icon {
  font-size: 80px;
  color: var(--md-sys-color-primary);
}

.oobe__title {
  font: var(--md-sys-typescale-display-small);
  margin: 0 0 12px;
}

.oobe__intro {
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
  max-width: 440px;
  margin: 0 0 32px;
}

.summary-list {
  list-style: none;
  margin: 0 0 24px;
  padding: 0;
  width: 100%;
  max-width: 420px;
}

.summary-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.summary-list__icon {
  font-size: 20px;
  color: var(--md-sys-color-tertiary);
}

.summary-list__name {
  flex: 1;
  font: var(--md-sys-typescale-body-large);
  text-align: left;
}

.summary-list__value {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.summary-banner,
.summary-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  margin: 0 0 24px;
  width: 100%;
  max-width: 460px;
  font: var(--md-sys-typescale-body-medium);
}

.summary-banner {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.summary-error {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.summary-banner__icon,
.summary-error__icon {
  font-size: 20px;
}

.summary-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
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

.btn--large {
  height: 56px;
  padding: 0 32px;
  font: var(--md-sys-typescale-title-medium);
}

.spinner {
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid color-mix(in srgb, var(--md-sys-color-on-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-on-primary);
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
</style>
