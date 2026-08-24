<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { mofoxApi } from '@/services/mofox-api';
import type { LicenseFetchResult } from '@shared/domain/install';

// 许可协议步骤：经主进程镜像轮询拉取 MoFox 的两份协议（EULA 与隐私政策），
// 以选项卡切换展示，用户勾选同意后向导才能继续。
const agreed = defineModel<boolean>('agreed', { default: false });

const loading = ref(false);
const error = ref('');
const licenses = ref<LicenseFetchResult | null>(null);
const activeTab = ref<'eula' | 'privacy'>('eula');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    licenses.value = await mofoxApi.fetchLicense();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="step">
    <h2 class="step__title">许可协议</h2>
    <p class="step__desc">请仔细阅读 MoFox 的最终用户许可协议与隐私政策，同意后才能继续安装。</p>

    <div v-if="loading" class="step__loading">
      <span class="spinner" aria-hidden="true"></span>
      <span>正在加载许可协议…</span>
    </div>

    <div v-else-if="error" class="license-error">
      <div class="info-banner">
        <span class="msr info-banner__icon" aria-hidden="true">error</span>
        <span>许可协议加载失败：{{ error }}</span>
      </div>
      <button type="button" class="btn btn--tonal state-layer" @click="load">
        <span class="msr" aria-hidden="true">refresh</span>
        重新加载
      </button>
    </div>

    <template v-else>
      <div class="license-tabs" role="tablist">
        <button
          type="button"
          class="license-tab state-layer"
          :class="{ 'license-tab--active': activeTab === 'eula' }"
          role="tab"
          :aria-selected="activeTab === 'eula'"
          @click="activeTab = 'eula'"
        >
          <span class="msr" aria-hidden="true">gavel</span>
          最终用户许可协议
        </button>
        <button
          type="button"
          class="license-tab state-layer"
          :class="{ 'license-tab--active': activeTab === 'privacy' }"
          role="tab"
          :aria-selected="activeTab === 'privacy'"
          @click="activeTab = 'privacy'"
        >
          <span class="msr" aria-hidden="true">privacy_tip</span>
          隐私政策
        </button>
      </div>

      <div class="license-box">
        {{ activeTab === 'eula' ? licenses?.eula.content : licenses?.privacy.content }}
      </div>

      <label class="checkbox-row" :class="{ 'checkbox-row--checked': agreed }">
        <input v-model="agreed" type="checkbox" />
        <span>
          <span class="checkbox-row__title">我已阅读并同意以上条款</span>
          <span class="checkbox-row__desc">同意后将继续安装 Neo-MoFox 及所选组件</span>
        </span>
      </label>
    </template>
  </section>
</template>

<style scoped>
.license-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.license-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.license-tab .msr {
  font-size: 18px;
}

.license-tab--active {
  border-color: var(--md-sys-color-primary);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.license-box {
  height: 320px;
  overflow-y: auto;
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-low);
  color: var(--md-sys-color-on-surface-variant);
  font-family: var(--md-ref-typeface-mono);
  font-size: 0.75rem;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.license-error {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
}
</style>
