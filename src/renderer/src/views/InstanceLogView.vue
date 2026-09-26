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
import { useWindowTitle } from '@/composables/use-window-title';
import { useToast } from '@/composables/use-toast';
import type { TerminalShortcutActions } from '@/composables/use-terminal-shortcuts';
import {
  createTerminalShortcutHandler,
  handleTerminalShortcut,
} from '@/composables/use-terminal-shortcuts';
import StatusBadge from '@/components/ui/StatusBadge.vue';

// 实例日志页维护双终端、实时输出、进程控制和日志工具操作。
const route = useRoute();
const router = useRouter();
const instancesStore = useInstancesStore();

// 路由实例、运行状态和当前日志来源决定界面的主要响应式状态。
const instanceId = computed(() => String(route.params.id ?? ''));
const instance = computed(() => instancesStore.byId(instanceId.value));
const status = computed<InstanceStatus>(() => instance.value?.status ?? 'stopped');
const isBusy = computed(() => status.value === 'starting' || status.value === 'stopping');

// 实例名称显示在窗口栏，跟随实例加载状态更新。
useWindowTitle({ title: () => instance.value?.name ?? '实例日志', subtitle: '运行日志' });

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
// 轻提示走全局单例，由 App 根节点的 AppToast 宿主统一渲染。
const { show: showToast } = useToast();
const uptimes = reactive<Record<InstanceProcessSource, string>>({
  mofox: '--:--:--',
  platform: '--:--:--',
});
const lineCounts = reactive<Record<InstanceProcessSource, number>>({ mofox: 0, platform: 0 });
// 独立进程控制的运行态与忙碌态，驱动单个来源的启动/重启/停止按钮。
const processRunning = reactive<Record<InstanceProcessSource, boolean>>({
  mofox: false,
  platform: false,
});
const processBusy = reactive<Record<InstanceProcessSource, boolean>>({
  mofox: false,
  platform: false,
});

interface TerminalBundle {
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
}

const bundles = new Map<InstanceProcessSource, TerminalBundle>();
let unsubscribePty: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
const resizeThrottles = new Map<InstanceProcessSource, ReturnType<typeof setTimeout>>();

const SEARCH_DECORATIONS = {
  matchBackground: '#3b5070',
  matchBorder: '#3b5070',
  matchOverviewRuler: '#4f7bd0',
  activeMatchBackground: '#367bf0',
  activeMatchBorder: '#367bf0',
  activeMatchColorOverviewRuler: '#367bf0',
};

/** 视为可编辑元素的标签名；焦点位于这些元素时不触发终端快捷键兜底。 */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

const TERMINAL_THEME = {
  background: '#101416',
  foreground: '#d8e3e7',
  cursor: '#d8e3e7',
  selectionBackground: '#3b507080',
  black: '#21262d',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};

function activeBundle(): TerminalBundle | undefined {
  return bundles.get(activeTab.value);
}

/** 焦点位于输入框等可编辑元素时跳过终端快捷键，交给元素自身的按键处理。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return EDITABLE_TAGS.has(target.tagName);
}

function onWindowKeydown(event: KeyboardEvent): void {
  // xterm 内部的按键已由 attachCustomKeyEventHandler 处理，这里只兜底其余焦点位置。
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('.xterm')) return;
  if (isEditableTarget(target)) return;
  if (handleTerminalShortcut(event, shortcutActions)) event.preventDefault();
}

/** 终端快捷键动作：终端内由 xterm 处理器触发，焦点在终端外时由窗口监听兜底触发。 */
const shortcutActions: TerminalShortcutActions = {
  copy: () => void copyLogs(),
  paste: () => void pasteToTerminal(activeBundle()?.terminal),
  selectAll: () => {
    const bundle = activeBundle();
    if (!bundle) return;
    bundle.terminal.selectAll();
    showToast('已全选终端内容，Ctrl+Shift+C 复制');
  },
  clear: () => void clearLogs(),
  search: () => toggleSearch(),
  escape: () => {
    // 搜索打开时 Esc 关闭搜索；否则放行给终端 / 页面。
    if (!searchVisible.value) return false;
    toggleSearch();
    return true;
  },
  switchTab: (index) => {
    // Alt+序号切换日志来源；目标与当前一致时也消费按键，避免透传给进程。
    const target = SOURCES[index];
    if (!target || target === activeTab.value) return true;
    activeTab.value = target;
    return true;
  },
};

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
  terminal.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault();
      // 链接统一交给系统浏览器打开，被安全策略拒绝时提示原因。
      mofoxApi.openExternal(uri).catch((error: unknown) => {
        showToast(`无法打开链接: ${error instanceof Error ? error.message : String(error)}`);
      });
    }),
  );
  terminal.open(container);
  fit.fit();

  // 终端快捷键：复制、粘贴、全选、搜索、清屏与 Alt+序号切换来源。
  terminal.attachCustomKeyEventHandler(createTerminalShortcutHandler(shortcutActions));

  terminal.onData((data) => {
    void mofoxApi.writeInstancePty(instanceId.value, source, data);
  });
  terminal.onResize(({ cols, rows }) => {
    const pending = resizeThrottles.get(source);
    if (pending) clearTimeout(pending);
    resizeThrottles.set(
      source,
      setTimeout(() => {
        void mofoxApi.resizeInstancePty(instanceId.value, source, cols, rows);
      }, 80),
    );
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
    } catch {
      /* 日志缓冲不可用时保持终端可用 */
    }
  }

  unsubscribePty = mofoxApi.on('instance-pty-data', ({ instanceId: id, source, data }) => {
    if (id !== instanceId.value) return;
    const bundle = bundles.get(source);
    if (!bundle) return;
    bundle.terminal.write(data);
    if (autoScroll.value && source === activeTab.value) bundle.terminal.scrollToBottom();
  });

  // 焦点不在终端 / 输入框时（如刚点击工具栏按钮、关闭搜索后），快捷键经窗口监听兜底生效。
  window.addEventListener('keydown', onWindowKeydown);

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
  window.removeEventListener('keydown', onWindowKeydown);
  unsubscribePty?.();
  resizeObserver?.disconnect();
  if (statsTimer) clearInterval(statsTimer);
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
    if (searchQuery.value)
      bundle?.search.findNext(searchQuery.value, { decorations: SEARCH_DECORATIONS });
  });
});

async function refreshStats(): Promise<void> {
  // 周期性查询两个子进程的运行时长与运行态，失败时回退占位显示。
  try {
    const stats = await mofoxApi.getInstanceStats(instanceId.value);
    for (const source of SOURCES) {
      const processStats = stats[source];
      processRunning[source] = processStats.running;
      uptimes[source] =
        processStats.running && processStats.uptimeMs !== null
          ? formatUptime(processStats.uptimeMs)
          : '--:--:--';
    }
  } catch {
    for (const source of SOURCES) {
      processRunning[source] = false;
      uptimes[source] = '--:--:--';
    }
  }
}

function formatUptime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
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

async function onStartSource(source: InstanceProcessSource): Promise<void> {
  // 独立进程控制：只影响单个来源，失败时恢复按钮可用并提示原因。
  if (processBusy[source]) return;
  processBusy[source] = true;
  try {
    await instancesStore.startProcess(instanceId.value, source);
  } catch (error) {
    showToast(`启动失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    processBusy[source] = false;
    void refreshStats();
  }
}

async function onStopSource(source: InstanceProcessSource): Promise<void> {
  if (processBusy[source]) return;
  processBusy[source] = true;
  try {
    await instancesStore.stopProcess(instanceId.value, source);
  } catch (error) {
    showToast(`停止失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    processBusy[source] = false;
    void refreshStats();
  }
}

async function onRestartSource(source: InstanceProcessSource): Promise<void> {
  if (processBusy[source]) return;
  processBusy[source] = true;
  try {
    await instancesStore.restartProcess(instanceId.value, source);
  } catch (error) {
    showToast(`重启失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    processBusy[source] = false;
    void refreshStats();
  }
}

function sourceLabel(source: InstanceProcessSource): string {
  return source === 'mofox' ? 'MoFox' : platformLabel.value;
}

function canStartSource(source: InstanceProcessSource): boolean {
  // 未配置安装目录的来源不允许单独启动。
  if (source === 'mofox') return Boolean(instance.value?.mofoxInstallDir);
  return Boolean(instance.value?.platform?.id && instance.value?.platform?.installDir);
}

// 全部控制：已配置来源是否全部/任一在运行，决定"全部启动"按钮的可用性。
const allProcessesRunning = computed(() =>
  SOURCES.every((source) => !canStartSource(source) || processRunning[source]),
);
const anyProcessRunning = computed(() =>
  SOURCES.some((source) => canStartSource(source) && processRunning[source]),
);

function toggleSearch(): void {
  searchVisible.value = !searchVisible.value;
  if (searchVisible.value) {
    requestAnimationFrame(() => searchInputRef.value?.focus());
  } else {
    searchQuery.value = '';
    for (const bundle of bundles.values()) bundle.search.clearDecorations();
    // 关闭搜索后焦点回到终端，保证 Ctrl+Shift+F 随时可以再次打开搜索。
    activeBundle()?.terminal.focus();
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
  if (searchQuery.value)
    activeBundle()?.search.findNext(searchQuery.value, { decorations: SEARCH_DECORATIONS });
}

function searchPrev(): void {
  if (searchQuery.value)
    activeBundle()?.search.findPrevious(searchQuery.value, { decorations: SEARCH_DECORATIONS });
}

function onSearchKeydown(event: KeyboardEvent): void {
  // Ctrl+Shift+F 在搜索框内同样切换开关，保证快捷键是真正意义上的打开 / 关闭。
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') {
    event.preventDefault();
    toggleSearch();
    return;
  }
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
  let wholeBuffer = false;
  if (!text) {
    bundle.terminal.selectAll();
    text = bundle.terminal.getSelection();
    bundle.terminal.clearSelection();
    wholeBuffer = true;
  }
  if (!text.trim()) {
    showToast('没有可复制的内容');
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast(wholeBuffer ? '已复制全部日志' : '已复制选中内容');
}

async function pasteToTerminal(target: Terminal | undefined): Promise<void> {
  if (!target) return;
  // 读取系统剪贴板并经 xterm 的 paste 写入 PTY，自动处理括号粘贴模式。
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      showToast('剪贴板为空');
      return;
    }
    target.paste(text);
    showToast('已粘贴到终端');
  } catch (error) {
    showToast(`无法读取剪贴板: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  } catch {
    /* 日志缓冲不可用时仅完成本地清理 */
  }
  showToast('已清空当前日志');
}

async function exportLogs(): Promise<void> {
  try {
    const filePath = await mofoxApi.exportInstanceLogs(instanceId.value, activeTab.value);
    showToast(`已导出: ${filePath}`);
  } catch (error) {
    showToast(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function goBack(): void {
  router.back();
}
</script>

<template>
  <div class="log-view">
    <section class="log-view__command-surface">
      <!-- 实例运行状态、运行时长与进程控制；实例名由窗口栏展示 -->
      <header class="log-view__header">
        <button
          class="icon-btn state-layer"
          type="button"
          title="返回"
          aria-label="返回"
          @click="goBack"
        >
          <span class="msr" aria-hidden="true">arrow_back</span>
        </button>

        <div class="log-view__meta">
          <StatusBadge :status="status" />
          <span class="log-view__uptime" :title="`MoFox 运行时长`">
            <span class="msr log-view__uptime-icon" aria-hidden="true">schedule</span>
            {{ uptimes[activeTab] }}
          </span>
        </div>

        <div class="log-view__controls">
          <span class="log-view__controls-label">
            <span class="msr log-view__controls-icon" aria-hidden="true">all_inclusive</span>
            全部
          </span>
          <button
            v-if="!allProcessesRunning"
            class="btn btn--filled state-layer"
            type="button"
            :disabled="isBusy"
            @click="onStart"
          >
            <span class="msr btn__icon" aria-hidden="true">play_arrow</span>
            启动
          </button>
          <button
            v-if="anyProcessRunning"
            class="btn btn--tonal state-layer"
            type="button"
            :disabled="isBusy"
            @click="onRestart"
          >
            <span class="msr btn__icon" aria-hidden="true">restart_alt</span>
            重启
          </button>
          <button
            v-if="anyProcessRunning || status === 'error'"
            class="btn btn--danger state-layer"
            type="button"
            :disabled="isBusy"
            @click="onStop"
          >
            <span class="msr btn__icon" aria-hidden="true">stop</span>
            停止
          </button>
        </div>
      </header>

      <!-- 平台与主程序的独立进程控制，支持单个来源启停 -->
      <div class="log-view__process-controls">
        <div v-for="source in SOURCES" :key="source" class="proc-group">
          <span class="proc-group__label">
            <span class="msr proc-group__icon" aria-hidden="true">
              {{ source === 'mofox' ? 'smart_toy' : 'lan' }}
            </span>
            {{ sourceLabel(source) }}
          </span>
          <div class="proc-group__actions">
            <template v-if="processRunning[source]">
              <button
                class="btn btn--sm btn--tonal state-layer"
                type="button"
                :disabled="processBusy[source] || isBusy"
                @click="onRestartSource(source)"
              >
                <span class="msr btn__icon" aria-hidden="true">restart_alt</span>
                重启
              </button>
              <button
                class="btn btn--sm btn--danger state-layer"
                type="button"
                :disabled="processBusy[source] || isBusy"
                @click="onStopSource(source)"
              >
                <span class="msr btn__icon" aria-hidden="true">stop</span>
                停止
              </button>
            </template>
            <button
              v-else
              class="btn btn--sm btn--filled state-layer"
              type="button"
              :disabled="processBusy[source] || isBusy || !canStartSource(source)"
              @click="onStartSource(source)"
            >
              <span class="msr btn__icon" aria-hidden="true">play_arrow</span>
              启动
            </button>
          </div>
        </div>
      </div>

      <!-- 日志来源标签与搜索、复制、导出等工具栏 -->
      <div class="log-view__tabs" role="tablist" aria-label="日志来源">
        <button
          v-for="(source, index) in SOURCES"
          :key="source"
          class="log-tab state-layer"
          type="button"
          role="tab"
          :aria-selected="activeTab === source"
          :class="{ 'log-tab--active': activeTab === source }"
          :title="`${sourceLabel(source)} 日志（Alt+${index + 1}）`"
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
          title="搜索（Ctrl+Shift+F）"
          aria-label="搜索（Ctrl+Shift+F）"
          :class="{ 'icon-btn--active': searchVisible }"
          @click="toggleSearch"
        >
          <span class="msr" aria-hidden="true">search</span>
        </button>
        <button
          class="icon-btn state-layer"
          type="button"
          title="复制日志（Ctrl+Shift+C）"
          aria-label="复制日志（Ctrl+Shift+C）"
          @click="copyLogs"
        >
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
        <button
          class="icon-btn state-layer"
          type="button"
          title="导出当前日志"
          aria-label="导出当前日志"
          @click="exportLogs"
        >
          <span class="msr" aria-hidden="true">download</span>
        </button>
        <button
          class="icon-btn state-layer"
          type="button"
          title="清空当前日志（Ctrl+Shift+K）"
          aria-label="清空当前日志（Ctrl+Shift+K）"
          @click="clearLogs"
        >
          <span class="msr" aria-hidden="true">delete_sweep</span>
        </button>
      </div>

      <!-- 常驻快捷键提示：独立成行、自动换行，确保每一项都完整可见 -->
      <div class="log-view__shortcuts" aria-label="终端快捷键">
        <span class="log-view__shortcut"><kbd>Ctrl+Shift+C</kbd> 复制</span>
        <span class="log-view__shortcut"><kbd>Ctrl+Shift+V</kbd> 粘贴</span>
        <span class="log-view__shortcut"><kbd>Ctrl+Shift+A</kbd> 全选</span>
        <span class="log-view__shortcut"><kbd>Ctrl+Shift+F</kbd> 搜索</span>
        <span class="log-view__shortcut"><kbd>Ctrl+Shift+K</kbd> 清空</span>
        <span class="log-view__shortcut"><kbd>Alt+1/2</kbd> 切换来源</span>
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
        <button
          class="icon-btn icon-btn--sm state-layer"
          type="button"
          title="上一个"
          aria-label="上一个"
          @click="searchPrev"
        >
          <span class="msr" aria-hidden="true">keyboard_arrow_up</span>
        </button>
        <button
          class="icon-btn icon-btn--sm state-layer"
          type="button"
          title="下一个"
          aria-label="下一个"
          @click="searchNext"
        >
          <span class="msr" aria-hidden="true">keyboard_arrow_down</span>
        </button>
        <button
          class="icon-btn icon-btn--sm state-layer"
          type="button"
          title="关闭搜索"
          aria-label="关闭搜索"
          @click="toggleSearch"
        >
          <span class="msr" aria-hidden="true">close</span>
        </button>
      </div>
    </section>

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
  </div>
</template>

<style scoped src="./InstanceLogView.css"></style>
