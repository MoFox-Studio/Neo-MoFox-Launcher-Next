<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { marked } from 'marked';
import { mofoxApi } from '@/services/mofox-api';
import type { LicenseFetchResult } from '@shared/domain/install';

// 许可协议步骤：经主进程镜像轮询拉取 Neo-MoFox 内部的两份协议
// （eula.md 与 PRIVACY.md），以 Markdown 渲染并切换展示；勾选同意后向导才能继续。
marked.setOptions({ gfm: true, breaks: true });

const agreed = defineModel<boolean>('agreed', { default: false });

const loading = ref(false);
const error = ref('');
const licenses = ref<LicenseFetchResult | null>(null);
const activeTab = ref<'eula' | 'privacy'>('eula');

const eulaHtml = computed(() => (licenses.value ? marked.parse(licenses.value.eula.content) : ''));
const privacyHtml = computed(() =>
  licenses.value ? marked.parse(licenses.value.privacy.content) : '',
);

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
    <div class="step-header">
      <h1>许可协议</h1>
      <p>请仔细阅读 Neo-MoFox 的最终用户许可协议与隐私政策，同意后才能继续安装。</p>
    </div>

    <div v-if="loading" class="license-content-wrapper">
      <div class="license-loading">
        <span class="msr rotating" aria-hidden="true">progress_activity</span>
        <span>正在加载许可协议…</span>
      </div>
    </div>

    <div v-else-if="error" class="license-content-wrapper">
      <div class="license-error">
        <span class="msr" aria-hidden="true">error</span>
        <span class="error-text">加载失败：{{ error }}</span>
        <button type="button" class="btn btn--tonal state-layer" @click="load">
          <span class="msr" aria-hidden="true">refresh</span>
          重新加载
        </button>
      </div>
    </div>

    <template v-else>
      <div class="license-tabs">
        <button
          type="button"
          class="license-tab"
          :class="{ 'license-tab--active': activeTab === 'eula' }"
          @click="activeTab = 'eula'"
        >
          <span class="msr" aria-hidden="true">gavel</span>
          最终用户许可协议
        </button>
        <button
          type="button"
          class="license-tab"
          :class="{ 'license-tab--active': activeTab === 'privacy' }"
          @click="activeTab = 'privacy'"
        >
          <span class="msr" aria-hidden="true">privacy_tip</span>
          隐私政策
        </button>
      </div>

      <div class="license-content-wrapper">
        <!-- 内容来自 MoFox 官方仓库的 eula.md / PRIVACY.md，属受信来源。 -->
        <!-- eslint-disable vue/no-v-html -->
        <div
          class="license-content"
          :class="{ 'license-content--eula': activeTab === 'eula' }"
          v-html="activeTab === 'eula' ? eulaHtml : privacyHtml"
        ></div>
        <!-- eslint-enable vue/no-v-html -->
      </div>

      <div class="license-agreement">
        <label class="checkbox-group">
          <input v-model="agreed" type="checkbox" />
          <span class="checkbox-label">我已阅读并同意以上条款（包括 EULA 和隐私政策）</span>
        </label>
      </div>
    </template>
  </section>
</template>
