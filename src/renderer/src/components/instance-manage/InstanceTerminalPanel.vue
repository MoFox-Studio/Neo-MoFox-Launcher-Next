<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { Instance, InstanceTerminalDirKind } from '@shared/domain/instance';
import type { TerminalShellOption } from '@shared/domain/terminal-shell';
import { mofoxApi } from '@/services/mofox-api';

// 实例终端面板：内置交互式 shell，可在实例目录、虚拟环境目录与平台目录之间切换，
// 并通过下拉框选择终端程序（Bash、PowerShell 等）。
// 同一实例同时只保持一个会话：切换目录或终端程序即重启会话，离开面板立即销毁；
// 会话始终激活实例虚拟环境（由主进程注入环境变量），与当前工作目录无关。
const props = defineProps<{
  instance: Instance;
}>();

const emit = defineEmits<{
  toast: [message: string];
}>();

type SessionState = 'starting' | 'running' | 'exited';

interface TerminalDirOption {
  kind: InstanceTerminalDirKind;
  label: string;
  icon: string;
  path: string;
  available: boolean;
}

// 可切换目录以实例记录为唯一来源；未配置的平台目录禁用切换入口。
const dirOptions = computed<TerminalDirOption[]>(() => [
  {
    kind: 'mofox',
    label: '实例目录',
    icon: 'folder_open',
    path: props.instance.mofoxInstallDir,
    available: Boolean(props.instance.mofoxInstallDir.trim()),
  },
  {
    kind: 'venv',
    label: '虚拟环境',
    icon: 'science',
    path: props.instance.venvDir,
    available: Boolean(props.instance.venvDir.trim()),
  },
  {
    kind: 'platform',
    label: '平台目录',
    icon: 'lan',
    path: props.instance.platform.installDir ?? '',
    available: Boolean(props.instance.platform.installDir?.trim()),
  },
]);

const activeKind = ref<InstanceTerminalDirKind>('mofox');
const activeOption = computed(
  () => dirOptions.value.find((option) => option.kind === activeKind.value) ?? dirOptions.value[0],
);

// 终端程序下拉框：主进程探测可用 shell；加载完成前仅提供“系统默认”占位。
const shells = ref<TerminalShellOption[]>([]);
const activeShellId = ref('');
const shellOptions = computed<TerminalShellOption[]>(() =>
  shells.value.length
    ? shells.value
    : [{ id: '', label: '系统默认', command: '', args: [], isDefault: true }],
);

const terminalRef = ref<HTMLElement | null>(null);
const sessionState = ref<SessionState>('starting');
const switching = ref(false);

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

let terminal: Terminal | null = null;
let fit: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeThrottle: ReturnType<typeof setTimeout> | null = null;
let unsubscribeData: (() => void) | null = null;
let unsubscribeExited: (() => void) | null = null;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 打开（或切换/重启）终端会话。
 *
 * 成功后重置终端视图并写入带目录的横幅；失败时保持终端可读并弹出提示。
 *
 * @param kind - 目标工作目录种类。
 * @param announce - 写入终端的横幅前缀文案。
 */
async function openSession(kind: InstanceTerminalDirKind, announce: string): Promise<void> {
  if (!terminal || switching.value) return;
  switching.value = true;
  sessionState.value = 'starting';
  try {
    const { cwd } = await mofoxApi.openInstanceTerminal(props.instance.id, kind, {
      shellId: activeShellId.value || undefined,
      size: { cols: terminal.cols, rows: terminal.rows },
    });
    terminal.reset();
    sessionState.value = 'running';
    terminal.write(`\x1b[90m[Launcher]\x1b[0m ${announce}\x1b[90m · ${cwd}\x1b[0m\r\n\r\n`);
    terminal.focus();
  } catch (error) {
    sessionState.value = 'exited';
    const message = describeError(error);
    terminal.write(`\x1b[31m[Launcher] 终端打开失败: ${message}\x1b[0m\r\n`);
    emit('toast', `终端打开失败: ${message}`);
  } finally {
    switching.value = false;
  }
}

/** 切换工作目录：点选目标卡片后立即以该目录重启终端会话。 */
function selectKind(option: TerminalDirOption): void {
  if (!option.available || switching.value || option.kind === activeKind.value) return;
  activeKind.value = option.kind;
  void openSession(option.kind, '工作目录已切换');
}

/** 切换终端程序：下拉框选中新 shell 后立即以当前目录重启会话。 */
function onShellChange(event: Event): void {
  const shellId = (event.target as HTMLSelectElement).value;
  if (switching.value || shellId === activeShellId.value) return;
  const label =
    shellOptions.value.find((option) => option.id === shellId)?.label ?? shellId ?? '系统默认';
  activeShellId.value = shellId;
  void openSession(activeKind.value, `终端程序已切换 · ${label}`);
}

/** 加载主进程探测到的可用终端程序；失败时保留“系统默认”占位。 */
async function loadShells(): Promise<void> {
  try {
    shells.value = await mofoxApi.listInstanceTerminalShells();
    // 未手动选择时同步展示系统默认 shell，避免下拉框停留在占位项。
    if (!activeShellId.value) {
      activeShellId.value = shells.value.find((shell) => shell.isDefault)?.id ?? '';
    }
  } catch {
    shells.value = [];
  }
}

/** 以当前目录重启会话；也用于会话结束后的重新打开。 */
function restartSession(): void {
  void openSession(activeKind.value, '终端会话已重启');
}

function clearScreen(): void {
  terminal?.clear();
  terminal?.focus();
}

function createTerminal(): boolean {
  const container = terminalRef.value;
  if (!container) return false;
  terminal = new Terminal({
    scrollback: 5000,
    fontSize: 13,
    fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    lineHeight: 1.35,
    cursorBlink: true,
    theme: TERMINAL_THEME,
  });
  fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault();
      mofoxApi
        .openExternal(uri)
        .catch((error: unknown) => emit('toast', `无法打开链接: ${describeError(error)}`));
    }),
  );
  terminal.open(container);
  fit.fit();
  terminal.onData((data) => {
    void mofoxApi.writeInstanceTerminal(props.instance.id, data);
  });
  terminal.onResize(({ cols, rows }) => {
    if (resizeThrottle) clearTimeout(resizeThrottle);
    resizeThrottle = setTimeout(() => {
      void mofoxApi.resizeInstanceTerminal(props.instance.id, cols, rows);
    }, 80);
  });
  return true;
}

onMounted(() => {
  if (!createTerminal()) return;
  resizeObserver = new ResizeObserver(() => fit?.fit());
  if (terminalRef.value) resizeObserver.observe(terminalRef.value);
  void loadShells();

  unsubscribeData = mofoxApi.on('instance-terminal-data', ({ instanceId, data }) => {
    if (instanceId !== props.instance.id) return;
    terminal?.write(data);
  });
  // 会话退出（如输入 exit）时展示重新打开入口；切换期间旧会话的退出事件由主进程过滤。
  unsubscribeExited = mofoxApi.on('instance-terminal-exited', ({ instanceId, exitCode }) => {
    if (instanceId !== props.instance.id || switching.value) return;
    sessionState.value = 'exited';
    terminal?.write(`\x1b[33m[Launcher] 终端会话已结束（退出码 ${exitCode}）\x1b[0m\r\n`);
  });

  void openSession(activeKind.value, '已打开实例终端');
});

onBeforeUnmount(() => {
  // 离开面板立即销毁会话：先退订事件，再关闭主进程 PTY，最后释放终端实例。
  unsubscribeData?.();
  unsubscribeExited?.();
  resizeObserver?.disconnect();
  if (resizeThrottle) clearTimeout(resizeThrottle);
  mofoxApi.closeInstanceTerminal(props.instance.id).catch(() => undefined);
  terminal?.dispose();
  terminal = null;
  fit = null;
});
</script>

<template>
  <section class="manage-group">
    <div class="manage-group__card">
      <!-- 卡片头部：分区图标 + 标题描述 + 清屏 / 重启会话 -->
      <div class="manage-group__heading">
        <span class="msr" aria-hidden="true">terminal</span>
        <div>
          <h2>终端</h2>
          <p>内置实例终端，可切换工作目录与终端程序（Bash、PowerShell 等）</p>
        </div>
        <div class="terminal-heading__actions">
          <button
            class="icon-btn state-layer"
            type="button"
            title="清屏"
            aria-label="清屏"
            @click="clearScreen"
          >
            <span class="msr" aria-hidden="true">mop</span>
          </button>
          <button
            class="btn btn--tonal state-layer"
            type="button"
            :disabled="switching || !activeOption?.available"
            @click="restartSession"
          >
            <span class="msr btn__icon" aria-hidden="true">restart_alt</span>
            重启会话
          </button>
        </div>
      </div>

      <div class="manage-group__body">
        <!-- 工作目录卡片组：同一时刻只能位于一个目录，点选后自动重启终端会话 -->
        <div class="terminal-dirs" role="group" aria-label="终端工作目录">
          <button
            v-for="option in dirOptions"
            :key="option.kind"
            class="terminal-dir state-layer"
            :class="{ 'terminal-dir--active': option.kind === activeKind }"
            type="button"
            :disabled="switching || !option.available"
            :title="option.available ? option.path : '未配置'"
            :aria-pressed="option.kind === activeKind"
            @click="selectKind(option)"
          >
            <span class="msr terminal-dir__icon" aria-hidden="true">{{ option.icon }}</span>
            <span class="terminal-dir__text">
              <span class="terminal-dir__label">{{ option.label }}</span>
              <span class="terminal-dir__path">{{ option.path || '未配置' }}</span>
            </span>
            <span
              v-if="option.kind === activeKind"
              class="msr terminal-dir__check"
              aria-hidden="true"
            >
              check_circle
            </span>
          </button>
        </div>

        <!-- 终端程序下拉框：切换后以当前目录重启终端会话 -->
        <div class="terminal-shell">
          <span class="msr terminal-shell__icon" aria-hidden="true">code</span>
          <md-outlined-select
            class="terminal-shell__select"
            label="终端程序"
            :value="activeShellId"
            :disabled="switching"
            @change="onShellChange"
          >
            <!-- Material Web Components 使用原生具名插槽，而不是 Vue 模板插槽。 -->
            <!-- eslint-disable vue/no-deprecated-slot-attribute -->
            <md-select-option v-for="shell in shellOptions" :key="shell.id" :value="shell.id">
              <div slot="headline">
                {{ shell.isDefault && shell.id ? `${shell.label}（默认）` : shell.label }}
              </div>
            </md-select-option>
            <!-- eslint-enable vue/no-deprecated-slot-attribute -->
          </md-outlined-select>
        </div>

        <!-- 终端窗口：暗色内嵌区域，会话结束时覆盖重新打开入口 -->
        <div class="terminal-panel__shell">
          <div ref="terminalRef" class="terminal-panel__terminal"></div>
          <transition name="terminal-fade">
            <div v-if="sessionState === 'exited'" class="terminal-panel__overlay" role="status">
              <span class="msr" aria-hidden="true">terminal</span>
              <p>终端会话已结束</p>
              <button class="btn btn--filled state-layer" type="button" @click="restartSession">
                <span class="msr btn__icon" aria-hidden="true">restart_alt</span>
                重新打开
              </button>
            </div>
          </transition>
        </div>

        <p class="terminal-panel__hint">
          切换目录或终端程序都会重启终端会话；实例虚拟环境始终处于激活状态。
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped src="./InstanceTerminalPanel.css"></style>
