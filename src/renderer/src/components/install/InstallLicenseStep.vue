<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { mofoxApi } from '@/services/mofox-api';
import { normalizeHttpsUrl, renderRemoteMarkdown } from '@/utils/remote-markdown';
import type { LicenseFetchResult } from '@shared/domain/install';

// 许可协议步骤：经主进程镜像轮询拉取 Neo-MoFox 内部的两份协议
// （eula.md 与 PRIVACY.md），以 Markdown 渲染并切换展示；勾选同意后向导才能继续。
const agreed = defineModel<boolean>('agreed', { default: false });

const loading = ref(false);
const error = ref('');
const licenses = ref<LicenseFetchResult | null>(null);
const activeTab = ref<'eula' | 'privacy'>('eula');

const eulaHtml = computed(() =>
  licenses.value ? renderRemoteMarkdown(licenses.value.eula.content) : '',
);
const privacyHtml = computed(() =>
  licenses.value ? renderRemoteMarkdown(licenses.value.privacy.content) : '',
);

function openLicenseLink(event: MouseEvent): void {
  const element = event.target instanceof window.Element ? event.target.closest('a') : null;
  if (!(element instanceof window.HTMLAnchorElement)) return;
  event.preventDefault();
  const url = normalizeHttpsUrl(element.href);
  if (url) void mofoxApi.openExternal(url);
}

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
  <section class="step step--license">
    <div class="step-header">
      <h1>许可协议</h1>
      <p>请仔细阅读 Neo-MoFox 的最终用户许可协议与隐私政策，同意后才能继续安装。</p>
    </div>

    <!-- 切换标签始终展示，加载与错误状态都发生在下方的正文区域内。 -->
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
      <div v-if="loading" class="license-loading">
        <span class="msr rotating" aria-hidden="true">progress_activity</span>
        <span>正在加载许可协议…</span>
      </div>

      <div v-else-if="error" class="license-error">
        <span class="msr" aria-hidden="true">error</span>
        <span class="error-text">加载失败：{{ error }}</span>
        <button type="button" class="btn btn--tonal state-layer" @click="load">
          <span class="msr" aria-hidden="true">refresh</span>
          重新加载
        </button>
      </div>

      <template v-else>
        <!-- 远程正文已禁用原始 HTML、过滤标签，并把链接限制为 HTTPS。 -->
        <!-- eslint-disable vue/no-v-html -->
        <div
          class="license-content"
          :class="{ 'license-content--eula': activeTab === 'eula' }"
          v-html="activeTab === 'eula' ? eulaHtml : privacyHtml"
          @click="openLicenseLink"
        ></div>
        <!-- eslint-enable vue/no-v-html -->
      </template>
    </div>

    <div v-if="!loading && !error" class="license-agreement">
      <label class="checkbox-group">
        <input v-model="agreed" type="checkbox" />
        <span class="checkbox-label">我已阅读并同意以上条款（包括 EULA 和隐私政策）</span>
      </label>
    </div>
  </section>
</template>
