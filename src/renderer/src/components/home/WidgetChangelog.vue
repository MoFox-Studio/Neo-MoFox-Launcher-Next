<script setup lang="ts">
// 版本更新日志部件：展示当前构建信息与当前发行版（按构建标签查询）的更新日志。
import { computed, onMounted, ref } from 'vue';
import type { ChangelogWidgetConfig } from '@shared/domain/home';
import type { LauncherReleaseNotes } from '@shared/domain/app-update';
import { mofoxApi } from '@/services/mofox-api';
import { useLauncherUpdate } from '@/composables/use-launcher-update';
import HomeWidgetCard from './HomeWidgetCard.vue';
import { normalizeHttpsUrl, renderRemoteMarkdown } from '@/utils/remote-markdown';

defineProps<{ config: ChangelogWidgetConfig }>();

const { buildInfo, loadBuildInfo } = useLauncherUpdate();

const notes = ref<LauncherReleaseNotes | null>(null);
const loading = ref(false);
const errorText = ref<string | null>(null);

/** 把任意抛出的错误收敛为可读文案。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

async function refresh(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  errorText.value = null;
  try {
    await loadBuildInfo();
    notes.value = await mofoxApi.getLauncherReleaseNotes();
  } catch (error) {
    errorText.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
});

/** 构建信息行：版本 + 渠道 + 可用的构建日期与提交哈希。 */
const buildInfoLine = computed(() => {
  const info = buildInfo.value;
  if (!info) return '';
  const parts = [info.channel === 'nightly' ? `每夜构建 ${info.version}` : `开发构建 ${info.version}`];
  if (info.commit) parts.push(info.commit);
  return parts.join(' · ');
});

/** 当前发行版的显示名；未获取到时回退标签。 */
const releaseTitle = computed(() => {
  const current = notes.value;
  if (!current?.found) return '';
  return current.name || current.tag;
});

const releaseDate = computed(() => {
  const current = notes.value;
  if (!current?.found || !current.publishedAt) return '';
  const parsed = Date.parse(current.publishedAt);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
});

/** 发行说明经净化后的 HTML；说明为空时不渲染该区块。 */
const notesHtml = computed(() => {
  const body = notes.value?.found ? notes.value.notes : '';
  if (!body.trim()) return '';
  return renderRemoteMarkdown(body);
});

/** 仅允许系统浏览器打开 HTTPS 链接；无效地址静默忽略。 */
async function openReleasePage(): Promise<void> {
  const url = notes.value?.found ? notes.value.url : '';
  const safe = normalizeHttpsUrl(url);
  if (safe) await mofoxApi.openExternal(safe);
}

/** 发行说明中的链接改为交给系统浏览器打开，阻止应用内导航。 */
function handleNotesClick(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor) return;
  event.preventDefault();
  const safe = normalizeHttpsUrl(anchor.getAttribute('href') ?? '');
  if (safe) void mofoxApi.openExternal(safe);
}
</script>

<template>
  <HomeWidgetCard title="版本更新日志" icon="history_edu" class="changelog-widget">
    <template #actions>
      <button
        type="button"
        class="home-widget__icon-button state-layer"
        title="刷新"
        aria-label="刷新更新日志"
        :disabled="loading"
        @click="refresh"
      >
        <span class="msr" aria-hidden="true">refresh</span>
      </button>
    </template>

    <div v-if="loading && !notes" class="home-widget__placeholder">
      <span class="msr" aria-hidden="true">progress_activity</span>
      <span>正在获取更新日志…</span>
    </div>

    <div v-else-if="errorText" class="home-widget__placeholder">
      <span class="msr home-widget__placeholder-error" aria-hidden="true">cloud_off</span>
      <span>更新日志获取失败：{{ errorText }}</span>
      <button type="button" class="home-widget__text-button state-layer" @click="refresh">
        重试
      </button>
    </div>

    <div v-else class="changelog-widget__content">
      <p v-if="config.showBuildInfo && buildInfoLine" class="changelog-widget__build">
        <span class="msr" aria-hidden="true">info</span>
        {{ buildInfoLine }}
      </p>

      <template v-if="notes?.found">
        <header class="changelog-widget__release-head">
          <h3>{{ releaseTitle }}</h3>
          <span v-if="releaseDate" class="changelog-widget__release-date">
            发布于 {{ releaseDate }}
          </span>
        </header>

        <!-- 内容来自 GitHub Release，已经 renderRemoteMarkdown 净化，仅保留白名单标签。 -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="notesHtml" class="home-markdown changelog-widget__notes" v-html="notesHtml" @click="handleNotesClick"></div>
        <p v-else class="changelog-widget__missing">该发行版没有填写更新说明。</p>

        <button
          type="button"
          class="changelog-widget__link state-layer"
          @click="openReleasePage"
        >
          在 GitHub 查看发行版
          <span class="msr" aria-hidden="true">open_in_new</span>
        </button>
      </template>

      <div v-else-if="notes" class="changelog-widget__dev">
        <span class="msr" aria-hidden="true">construction</span>
        <p>当前为开发构建，没有对应的已发布发行版；每次构建的说明可在 GitHub Releases 页查看。</p>
        <button
          type="button"
          class="changelog-widget__link state-layer"
          @click="openReleasePage"
        >
          打开 Releases 页面
          <span class="msr" aria-hidden="true">open_in_new</span>
        </button>
      </div>
    </div>
  </HomeWidgetCard>
</template>

<style scoped>
.changelog-widget__content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.changelog-widget__build {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  padding: 6px 14px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--app-glass-row);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
  font-family: var(--md-ref-typeface-mono);
}

.changelog-widget__build .msr {
  font-size: 16px;
}

.changelog-widget__release-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.changelog-widget__release-head h3 {
  margin: 0;
  font: var(--md-sys-typescale-title-medium);
}

.changelog-widget__release-date {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

/* 发行说明区：超出固定高度后内部滚动；排版复用全局 .home-markdown。 */
.changelog-widget__notes {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px 2px;
}

.changelog-widget__missing {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.changelog-widget__link {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.changelog-widget__link .msr {
  font-size: 18px;
}

.changelog-widget__dev {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--app-glass-row);
}

.changelog-widget__dev .msr {
  font-size: 26px;
  color: var(--md-sys-color-on-surface-variant);
}

.changelog-widget__dev p {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}
</style>
