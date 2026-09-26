<script setup lang="ts">
// 文档部件：直接渲染当前文档正文，多文档时以标签页切换；弹窗仅作为放大阅读入口。
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { DocsWidgetConfig, HomeDocEntry } from '@shared/domain/home';
import { mofoxApi } from '@/services/mofox-api';
import HomeWidgetCard from './HomeWidgetCard.vue';
import WidgetDocReaderDialog from './WidgetDocReaderDialog.vue';
import { normalizeHttpsUrl, renderRemoteMarkdown } from '@/utils/remote-markdown';

const props = defineProps<{ config: DocsWidgetConfig }>();

const router = useRouter();

const activeId = ref<string | null>(null);
const contentHtml = ref('');
const busy = ref(false);
const errorText = ref<string | null>(null);
/** 最近一次尝试加载的文档签名；签名一致且已有结果时跳过重复请求。 */
let loadedSig = '';

const documents = computed(() => props.config.documents);

/** 当前展示的文档：优先取标签页选中的条目，缺省回落到第一篇。 */
const activeEntry = computed<HomeDocEntry | null>(
  () => documents.value.find((entry) => entry.id === activeId.value) ?? documents.value[0] ?? null,
);

const showTabs = computed(() => documents.value.length > 1);

/** 把任意抛出的错误收敛为可读文案。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

/** 文档内容签名：id + 来源标识，用户在设置中修改来源后自动触发重新加载。 */
function docSig(entry: HomeDocEntry): string {
  return `${entry.id}|${entry.kind}|${entry.kind === 'remote' ? entry.url : entry.path}`;
}

/**
 * 加载当前文档的正文并渲染为净化后的 HTML。
 *
 * @param force - 为 true 时忽略缓存强制刷新。
 */
async function load(force = false): Promise<void> {
  const entry = activeEntry.value;
  if (!entry) {
    contentHtml.value = '';
    errorText.value = null;
    loadedSig = '';
    return;
  }
  const sig = docSig(entry);
  if (!force && sig === loadedSig && (contentHtml.value || errorText.value)) return;
  busy.value = true;
  errorText.value = null;
  contentHtml.value = '';
  try {
    const content =
      entry.kind === 'local'
        ? await mofoxApi.readHomeDoc(entry.path ?? '')
        : await mofoxApi.fetchHomeRemoteDoc(entry.url ?? '');
    contentHtml.value = renderRemoteMarkdown(content.content);
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loadedSig = sig;
    busy.value = false;
  }
}

// 签名变化（切换标签页或配置变更）即重新加载；immediate 覆盖首次挂载。
watch(
  () => (activeEntry.value ? docSig(activeEntry.value) : ''),
  () => {
    void load();
  },
  { immediate: true },
);

/** 放大阅读：复用阅读弹窗展示已加载的正文。 */
const readerOpen = ref(false);

function openReader(): void {
  if (!contentHtml.value) return;
  readerOpen.value = true;
}

function closeReader(): void {
  readerOpen.value = false;
}

/** 仅允许系统浏览器打开 HTTPS 链接；无效地址静默忽略。 */
async function openExternalUrl(url: string): Promise<void> {
  const safe = normalizeHttpsUrl(url);
  if (safe) await mofoxApi.openExternal(safe);
}

/** 正文中的链接改为交给系统浏览器打开，阻止应用内导航。 */
function handleBodyClick(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor) return;
  event.preventDefault();
  void openExternalUrl(anchor.getAttribute('href') ?? '');
}

function openSettings(): void {
  void router.push({ name: 'settings' });
}
</script>

<template>
  <HomeWidgetCard title="文档" icon="description" class="docs-widget">
    <template #actions>
      <button
        v-if="documents.length > 0"
        type="button"
        class="home-widget__icon-button state-layer"
        title="重新加载"
        aria-label="重新加载文档"
        :disabled="busy"
        @click="load(true)"
      >
        <span class="msr" aria-hidden="true">refresh</span>
      </button>
      <button
        v-if="contentHtml"
        type="button"
        class="home-widget__icon-button state-layer"
        title="放大阅读"
        aria-label="放大阅读"
        @click="openReader"
      >
        <span class="msr" aria-hidden="true">open_in_new</span>
      </button>
    </template>

    <!-- 多文档时的标签页；单文档直接展示，无需切换。 -->
    <div v-if="showTabs" class="docs-widget__tabs" role="tablist" aria-label="文档切换">
      <button
        v-for="entry in documents"
        :key="entry.id"
        type="button"
        role="tab"
        class="docs-widget__tab state-layer"
        :class="{ 'docs-widget__tab--active': entry.id === activeEntry?.id }"
        :aria-selected="entry.id === activeEntry?.id"
        :title="entry.kind === 'remote' ? entry.url : entry.path"
        @click="activeId = entry.id"
      >
        <span class="msr" aria-hidden="true">
          {{ entry.kind === 'remote' ? 'language' : 'article' }}
        </span>
        <span class="docs-widget__tab-name">{{ entry.name }}</span>
      </button>
    </div>

    <div v-if="documents.length === 0" class="docs-widget__empty">
      <span class="msr" aria-hidden="true">library_books</span>
      <p>还没有添加文档，可在「设置 → 主页」中添加本地或远程 Markdown 文档。</p>
      <button type="button" class="home-widget__text-button state-layer" @click="openSettings">
        前往设置
      </button>
    </div>

    <div v-else class="docs-widget__content">
      <div v-if="busy" class="home-widget__placeholder">
        <span class="msr" aria-hidden="true">progress_activity</span>
        <span>正在加载文档…</span>
      </div>

      <div v-else-if="errorText" class="home-widget__placeholder">
        <span class="msr home-widget__placeholder-error" aria-hidden="true">error</span>
        <span>{{ errorText }}</span>
        <button type="button" class="home-widget__text-button state-layer" @click="load(true)">
          重试
        </button>
      </div>

      <!-- 内容已在加载后经 renderRemoteMarkdown 净化，仅保留白名单标签。 -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-else-if="contentHtml" class="home-markdown docs-widget__markdown" v-html="contentHtml" @click="handleBodyClick"></div>
    </div>

    <WidgetDocReaderDialog
      :open="readerOpen"
      :title="activeEntry?.name ?? '文档'"
      :busy="false"
      :error="null"
      :html="contentHtml"
      @close="closeReader"
      @retry="load(true)"
    />
  </HomeWidgetCard>
</template>

<style scoped>
/* 标签页：横向滚动容纳多文档，选中态用主色下划线强调。 */
.docs-widget__tabs {
  display: flex;
  gap: 2px;
  margin: 0 -6px 8px;
  padding: 0 6px;
  overflow-x: auto;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  scrollbar-width: thin;
}

.docs-widget__tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  min-height: 38px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 8px 8px 0 0;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.docs-widget__tab .msr {
  font-size: 16px;
}

.docs-widget__tab-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docs-widget__tab--active {
  border-bottom-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-primary);
}

/* 正文区：超出固定高度后内部滚动，避免长文档撑开主页。 */
.docs-widget__content {
  min-height: 120px;
}

.docs-widget__markdown {
  max-height: 340px;
  overflow-y: auto;
  padding-right: 4px;
}

.docs-widget__empty {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--app-glass-row);
  text-align: center;
}

.docs-widget__empty .msr {
  font-size: 28px;
  color: var(--md-sys-color-on-surface-variant);
}

.docs-widget__empty p {
  margin: 0;
  max-width: 380px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}
</style>
