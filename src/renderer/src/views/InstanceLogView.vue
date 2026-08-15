<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { InstanceProcessSource, InstanceStatus } from '@shared/domain/instance';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import StatusBadge from '@/components/StatusBadge.vue';

// 实例日志页维护双终端、实时输出、进程控制和日志工具操作。
const route = useRoute();
const router = useRouter();
const instancesStore = useInstancesStore();

// 路由实例、运行状态和当前日志来源决定界面的主要响应式状态。
const instanceId = computed(() => String(route.params.id ?? ''));
const instance = computed(() => instancesStore.byId(instanceId.value));
const status = computed<InstanceStatus>(() => instance.value?.status ?? 'stopped');
const isRunning = computed(() => status.value === 'running');
const isBusy = computed(() => status.value === 'starting' || status.value === 'stopping');

const PLATFORM_LABELS: Record<string, string> = { napcat: 'NapCat', snowluma: 'SnowLuma' };
const platformLabel = computed(() => {
  const id = instance.value?.platform?.id ?? '';
  return PLATFORM_LABELS[id] ?? id ?? '平台';
});

const SOURCES: InstanceProcessSource[] = ['mofox', 'platform'];
const activeTab = ref<InstanceProcessSource>('mofox');

const terminalRefs = {
  mofox: ref<HTMLElement | null>(null),
  platform: ref<HTMLElement | null>(null),
};

// 搜索、自动滚动、提示信息和进程统计仅服务于当前日志会话。
const searchVisible = ref(false);
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);
const autoScroll = ref(true);
const toast = ref('');
const uptimes = reactive<Record<InstanceProcessSource, string>>({ mofox: '--:--:--', platform: '--:--:--' });
const lineCounts = reactive<Record<InstanceProcessSource, number>>({ mofox: 0, platform: 0 });

interface TerminalBundle {
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
}

const bundles = new Map<InstanceProcessSource, TerminalBundle>();
let unsubscribePty: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const resizeThrottles = new Map<InstanceProcessSource, ReturnType<typeof setTimeout>>();

const SEARCH_DECORATIONS = {
  matchBackground: '#3b5070',
  matchBorder: '#3b5070',
  matchOverviewRuler: '#4f7bd0',
  activeMatchBackground: '#7c5cdb',
  activeMatchBorder: '#7c5cdb',
  activeMatchColorOverviewRuler: '#7c5cdb',
};

const TERMINAL_THEME = {
  background: '#101416',
  foreground: '#d8e3e7',
  cursor: '#d8e3e7',
  selectionBackground: '#3b507080',
  black: '#21262d', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
  blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
  brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
  brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
};

function activeBundle(): TerminalBundle | undefined {
  return bundles.get(activeTab.value);
}

function createBundle(source: InstanceProcessSource): TerminalBundle | undefined {
  // 每个来源拥有独立 xterm 实例，并将输入、尺寸和滚动状态同步到桥接层。
  const container = terminalRefs[source].value;
  if (!container) return undefined;
  const terminal = new Terminal({
    convertEol: true,
    scrollback: 10_000,
    fontSize: 13,
    fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    lineHeight: 1.35,
    cursorBlink: false,
    theme: TERMINAL_THEME,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(search);
  terminal.loadAddon(new WebLinksAddon((event, uri) => {
    event.preventDefault();
    window.open(uri, '_blank');
  }));
  terminal.open(container);
  fit.fit();

  terminal.onData((data) => {
    void mofoxApi.writeInstancePty(instanceId.value, source, data);
  });
  terminal.onResize(({ cols, rows }) => {
    const pending = resizeThrottles.get(source);
    if (pending) clearTimeout(pending);
    resizeThrottles.set(source, setTimeout(() => {
      void mofoxApi.resizeInstancePty(instanceId.value, source, cols, rows);
    }, 80));
  });
  terminal.onScroll(() => {
    if (source !== activeTab.value) return;
    const buffer = terminal.buffer.active;
    const atBottom = buffer.viewportY >= buffer.baseY;
    if (!atBottom && autoScroll.value) autoScroll.value = false;
    else if (atBottom && !autoScroll.value) autoScroll.value = true;
  });
  terminal.onLineFeed(() => {
    lineCounts[source] += 1;
  });

  const bundle = { terminal, fit, search };
  bundles.set(source, bundle);
  return bundle;
}

onMounted(async () => {
  // 异步恢复实例、历史缓冲和实时订阅，再启动尺寸观察与统计轮询。
  await instancesStore.refresh();
  if (!instance.value) {
    void router.replace({ name: 'instances' });
    return;
  }

  for (const source of SOURCES) {
    const bundle = createBundle(source);
    if (!bundle) continue;
    try {
      const history = await mofoxApi.getInstanceLogBuffer(instanceId.value, source);
      if (history) bundle.terminal.write(history);
    } catch { /* 日志缓冲不可用时保持终端可用 */ }
  }

  unsubscribePty = mofoxApi.on('instance-pty-data', ({ instanceId: id, source, data }) => {
    if (id !== instanceId.value) return;
    const bundle = bundles.get(source);
    if (!bundle) return;
    bundle.terminal.write(data);
    if (autoScroll.value && source === activeTab.value) bundle.terminal.scrollToBottom();
  });

  resizeObserver = new ResizeObserver(() => activeBundle()?.fit.fit());
  for (const source of SOURCES) {
    const container = terminalRefs[source].value;
    if (container) resizeObserver.observe(container);
  }

  statsTimer = setInterval(refreshStats, 1000);
  void refreshStats();
});

onBeforeUnmount(() => {
  // 释放 IPC 订阅、浏览器观察器、定时器和终端资源。
  unsubscribePty?.();
  resizeObserver?.disconnect();
  if (statsTimer) clearInterval(statsTimer);
  if (toastTimer) clearTimeout(toastTimer);
  for (const pending of resizeThrottles.values()) clearTimeout(pending);
  for (const bundle of bundles.values()) bundle.terminal.dispose();
  bundles.clear();
});

watch(activeTab, () => {
  // 重新适配新显示的终端，并恢复当前搜索结果。
  requestAnimationFrame(() => {
    const bundle = activeBundle();
    bundle?.fit.fit();
    if (autoScroll.value) bundle?.terminal.scrollToBottom();
    if (searchQuery.value) bundle?.search.findNext(searchQuery.value, { decorations: SEARCH_DECORATIONS });
  });
});

async function refreshStats(): Promise<void> {
  // 周期性查询两个子进程的运行时长，失败时回退占位显示。
  try {
    const stats = await mofoxApi.getInstanceStats(instanceId.value);
    for (const source of SOURCES) {
      const processStats = stats[source];
      uptimes[source] = processStats.running && processStats.uptimeMs !== null
        ? formatUptime(processStats.uptimeMs)
        : '--:--:--';
    }
  } catch {
    for (const source of SOURCES) uptimes[source] = '--:--:--';
  }
}

function formatUptime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 2600);
}

async function onStart(): Promise<void> {
  try {
    await instancesStore.start(instanceId.value);
  } catch (error) {
    showToast(`启动失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function onStop(): Promise<void> {
  try {
    await instancesStore.stop(instanceId.value);
  } catch (error) {
    showToast(`停止失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function onRestart(): Promise<void> {
  try {
    await instancesStore.restart(instanceId.value);
  } catch (error) {
    showToast(`重启失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function toggleSearch(): void {
  searchVisible.value = !searchVisible.value;
  if (searchVisible.value) {
    requestAnimationFrame(() => searchInputRef.value?.focus());
  } else {
    searchQuery.value = '';
    for (const bundle of bundles.values()) bundle.search.clearDecorations();
  }
}

watch(searchQuery, (query) => {
  const bundle = activeBundle();
  if (!bundle) return;
  if (!query) {
    bundle.search.clearDecorations();
    return;
  }
  bundle.search.findNext(query, { decorations: SEARCH_DECORATIONS });
});

function searchNext(): void {
  if (searchQuery.value) activeBundle()?.search.findNext(searchQuery.value, { decorations: SEARCH_DECORATIONS });
}

function searchPrev(): void {
  if (searchQuery.value) activeBundle()?.search.findPrevious(searchQuery.value, { decorations: SEARCH_DECORATIONS });
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    if (event.shiftKey) searchPrev();
    else searchNext();
  } else if (event.key === 'Escape') {
    toggleSearch();
  }
}

async function copyLogs(): Promise<void> {
  // 优先复制用户选区；无选区时复制当前终端的完整内容。
  const bundle = activeBundle();
  if (!bundle) return;
  const selection = bundle.terminal.getSelection();
  let text = selection;
  if (!text) {
    bundle.terminal.selectAll();
    text = bundle.terminal.getSelection();
    bundle.terminal.clearSelection();
  }
  if (!text.trim()) {
    showToast('没有可复制的内容');
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast('已复制到剪贴板');
}

function toggleAutoScroll(): void {
  autoScroll.value = !autoScroll.value;
  if (autoScroll.value) activeBundle()?.terminal.scrollToBottom();
}

async function clearLogs(): Promise<void> {
  // 同时清除终端视图、仓库缓存及可用的后端日志缓冲。
  const source = activeTab.value;
  bundles.get(source)?.terminal.reset();
  lineCounts[source] = 0;
  instancesStore.clearLog(instanceId.value, source);
  try {
    await mofoxApi.clearInstanceLogBuffer(instanceId.value, source);
  } catch { /* 日志缓冲不可用时仅完成本地清理 */ }
}

async function exportLogs(): Promise<void> {
  try {
    const filePath = await mofoxApi.exportInstanceLogs(instanceId.value, activeTab.value);
    showToast(`已导出: ${filePath}`);
  } catch (error) {
    showToast(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function openFolder(): void {
  void mofoxApi.openInstanceFolder(instanceId.value);
}

function goBack(): void {
  router.back();
}
</script>

<template>
  <div class="log-view">
    <!-- 实例标题、运行状态与进程控制 -->
    <header class="log-view__header">
      <button class="icon-btn state-layer" type="button" title="返回" aria-label="返回" @click="goBack">
        <span class="msr" aria-hidden="true">arrow_back</span>
      </button>

      <div class="log-view__title-block">
        <h1 class="log-view__title">{{ instance?.name ?? '实例' }}</h1>
        <div class="log-view__meta">
          <StatusBadge :status="status" />
          <span class="log-view__uptime" :title="`MoFox 运行时长`">
            <span class="msr log-view__uptime-icon" aria-hidden="true">schedule</span>
            {{ uptimes[activeTab] }}
          </span>
        </div>
      </div>

      <div class="log-view__controls">
        <button
          v-if="isRunning"
          class="btn btn--tonal state-layer"
          type="button"
          :disabled="isBusy"
          @click="onRestart"
        >
          <span class="msr btn__icon" aria-hidden="true">restart_alt</span>
          重启
        </button>
        <button
          v-if="isRunning || status === 'error'"
          class="btn btn--danger state-layer"
          type="button"
          :disabled="isBusy"
          @click="onStop"
        >
          <span class="msr btn__icon" aria-hidden="true">stop</span>
          停止
        </button>
        <button
          v-else
          class="btn btn--filled state-layer"
          type="button"
          :disabled="isBusy"
          @click="onStart"
        >
          <span class="msr btn__icon" aria-hidden="true">play_arrow</span>
          启动
        </button>
      </div>
    </header>

    <!-- 日志来源标签与搜索、复制、导出等工具栏 -->
    <div class="log-view__tabs" role="tablist" aria-label="日志来源">
      <button
        v-for="source in SOURCES"
        :key="source"
        class="log-tab state-layer"
        type="button"
        role="tab"
        :aria-selected="activeTab === source"
        :class="{ 'log-tab--active': activeTab === source }"
        @click="activeTab = source"
      >
        <span class="msr log-tab__icon" aria-hidden="true">
          {{ source === 'mofox' ? 'smart_toy' : 'lan' }}
        </span>
        {{ source === 'mofox' ? 'MoFox' : platformLabel }}
        <span v-if="lineCounts[source] > 0" class="log-tab__count">{{ lineCounts[source] }}</span>
      </button>

      <span class="log-view__toolbar-spacer"></span>

      <button
        class="icon-btn state-layer"
        type="button"
        title="搜索"
        aria-label="搜索"
        :class="{ 'icon-btn--active': searchVisible }"
        @click="toggleSearch"
      >
        <span class="msr" aria-hidden="true">search</span>
      </button>
      <button class="icon-btn state-layer" type="button" title="复制日志" aria-label="复制日志" @click="copyLogs">
        <span class="msr" aria-hidden="true">content_copy</span>
      </button>
      <button
        class="icon-btn state-layer"
        type="button"
        :title="autoScroll ? '暂停自动滚动' : '恢复自动滚动'"
        :aria-label="autoScroll ? '暂停自动滚动' : '恢复自动滚动'"
        :class="{ 'icon-btn--active': autoScroll }"
        @click="toggleAutoScroll"
      >
        <span class="msr" aria-hidden="true">vertical_align_bottom</span>
      </button>
      <button class="icon-btn state-layer" type="button" title="导出当前日志" aria-label="导出当前日志" @click="exportLogs">
        <span class="msr" aria-hidden="true">download</span>
      </button>
      <button class="icon-btn state-layer" type="button" title="清空当前日志" aria-label="清空当前日志" @click="clearLogs">
        <span class="msr" aria-hidden="true">delete_sweep</span>
      </button>
      <button class="icon-btn state-layer" type="button" title="打开实例目录" aria-label="打开实例目录" @click="openFolder">
        <span class="msr" aria-hidden="true">folder_open</span>
      </button>
    </div>

    <!-- 当前终端的增量搜索框 -->
    <div v-if="searchVisible" class="log-view__search">
      <span class="msr log-view__search-icon" aria-hidden="true">search</span>
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        type="text"
        class="log-view__search-input"
        placeholder="搜索日志（Enter 下一个，Shift+Enter 上一个）"
        @keydown="onSearchKeydown"
      />
      <button class="icon-btn icon-btn--sm state-layer" type="button" title="上一个" aria-label="上一个" @click="searchPrev">
        <span class="msr" aria-hidden="true">keyboard_arrow_up</span>
      </button>
      <button class="icon-btn icon-btn--sm state-layer" type="button" title="下一个" aria-label="下一个" @click="searchNext">
        <span class="msr" aria-hidden="true">keyboard_arrow_down</span>
      </button>
      <button class="icon-btn icon-btn--sm state-layer" type="button" title="关闭搜索" aria-label="关闭搜索" @click="toggleSearch">
        <span class="msr" aria-hidden="true">close</span>
      </button>
    </div>

    <!-- 双终端容器保持挂载，以保留非活动来源的滚动缓冲 -->
    <div class="log-view__terminals">
      <div
        :ref="terminalRefs.mofox"
        class="log-view__terminal"
        :class="{ 'log-view__terminal--hidden': activeTab !== 'mofox' }"
      ></div>
      <div
        :ref="terminalRefs.platform"
        class="log-view__terminal"
        :class="{ 'log-view__terminal--hidden': activeTab !== 'platform' }"
      ></div>
    </div>

    <transition name="toast">
      <div v-if="toast" class="log-view__toast" role="status">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
/* 日志页框架、标题和进程控制 */
.log-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.log-view__header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 32px 12px;
}

.log-view__title-block {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-view__title {
  margin: 0;
  font: var(--md-sys-typescale-headline-small);
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-view__meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.log-view__uptime {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: var(--md-sys-typescale-label-medium);
  font-variant-numeric: tabular-nums;
  color: var(--md-sys-color-on-surface-variant);
}

.log-view__uptime-icon {
  font-size: 16px;
}

.log-view__controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 来源标签与日志工具栏 */
.log-view__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 32px 8px;
}

.log-tab {
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
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.log-tab--active {
  border-color: transparent;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.log-tab__icon {
  font-size: 18px;
}

.log-tab__count {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, currentColor 14%, transparent);
  font: var(--md-sys-typescale-label-small);
  font-variant-numeric: tabular-nums;
}

.log-view__toolbar-spacer {
  flex: 1;
}

/* 搜索输入区与终端显示层 */
.log-view__search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 32px 8px;
  height: 44px;
  padding: 0 12px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-high);
}

.log-view__search-icon {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 20px;
}

.log-view__search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
}

.log-view__search-input::placeholder {
  color: var(--md-sys-color-on-surface-variant);
}

.log-view__terminals {
  flex: 1;
  min-height: 0;
  position: relative;
  margin: 0 32px 24px;
}

.log-view__terminal {
  position: absolute;
  inset: 0;
  padding: 12px;
  border-radius: var(--md-sys-shape-corner-large);
  background: #101416;
  overflow: hidden;
}

.log-view__terminal--hidden {
  visibility: hidden;
  pointer-events: none;
}

.log-view__terminal :deep(.xterm) {
  height: 100%;
}

/* 操作反馈提示与过渡动画 */
.log-view__toast {
  position: absolute;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100% - 64px));
  padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  font: var(--md-sys-typescale-body-medium);
  box-shadow: var(--md-sys-elevation-level3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 30;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2)
      var(--md-sys-motion-easing-standard);
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: translateX(-50%);
  }
}

/* 进程操作按钮与图标按钮 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.btn__icon {
  font-size: 18px;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--tonal {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.btn--danger {
  background: color-mix(in srgb, var(--md-sys-color-error) 12%, transparent);
  color: var(--md-sys-color-error);
}

.icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.icon-btn--sm {
  width: 32px;
  height: 32px;
}

.icon-btn--active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
</style>
