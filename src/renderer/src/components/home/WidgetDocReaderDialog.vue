<script setup lang="ts">
// 文档阅读弹窗：承载净化后的 Markdown 正文；链接拦截后交给系统浏览器打开。
import { computed } from 'vue';
import BaseDialog from '@/components/ui/BaseDialog.vue';
import { mofoxApi } from '@/services/mofox-api';
import { normalizeHttpsUrl } from '@/utils/remote-markdown';

const props = defineProps<{
  open: boolean;
  title: string;
  busy: boolean;
  error: string | null;
  /** 已净化的 Markdown HTML。 */
  html: string;
}>();

const emit = defineEmits<{ close: []; retry: [] }>();

const showBody = computed(() => props.html.length > 0);

/** 仅允许系统浏览器打开 HTTPS 链接；无效地址静默忽略。 */
async function openExternalUrl(url: string): Promise<void> {
  const safe = normalizeHttpsUrl(url);
  if (safe) await mofoxApi.openExternal(safe);
}

/** 文档正文中的链接改为交给系统浏览器打开，阻止应用内导航。 */
function handleBodyClick(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor) return;
  event.preventDefault();
  void openExternalUrl(anchor.getAttribute('href') ?? '');
}
</script>

<template>
  <BaseDialog
    :open="open"
    :title="title"
    :width="760"
    :show-actions="false"
    class="doc-reader"
    @close="emit('close')"
  >
    <div class="doc-reader__body">
      <div v-if="busy" class="doc-reader__placeholder">
        <span class="msr" aria-hidden="true">progress_activity</span>
        <span>正在加载文档…</span>
      </div>

      <div v-else-if="error" class="doc-reader__placeholder">
        <span class="msr doc-reader__error-icon" aria-hidden="true">error</span>
        <span>{{ error }}</span>
      </div>

      <!-- 内容已在打开前经 renderRemoteMarkdown 净化，仅保留白名单标签。 -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-else-if="showBody" class="home-markdown" v-html="html" @click="handleBodyClick"></div>
    </div>

    <template #actions>
      <button v-if="error" type="button" class="doc-reader__button doc-reader__button--filled state-layer" @click="emit('retry')">
        重试
      </button>
      <button type="button" class="doc-reader__button doc-reader__button--text state-layer" @click="emit('close')">
        关闭
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.doc-reader__body {
  max-height: min(64vh, 640px);
  overflow-y: auto;
  padding-right: 4px;
}

.doc-reader__placeholder {
  min-height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.doc-reader__placeholder .msr {
  font-size: 28px;
}

.doc-reader__error-icon {
  color: var(--md-sys-color-error);
}

.doc-reader__button {
  min-height: 40px;
  padding: 0 20px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.doc-reader__button--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.doc-reader__button--text {
  background: transparent;
  color: var(--md-sys-color-primary);
}
</style>
