<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Instance } from '@shared/domain/instance';
import StatusBadge from './StatusBadge.vue';
import ExportPackDialog from './ExportPackDialog.vue';

interface Props {
  instance: Instance;
}

const props = defineProps<Props>();
const router = useRouter();
const exportOpen = ref(false);

// 将卡片操作上抛给实例列表，由上层统一处理进程和文件系统行为。
const emit = defineEmits<{
  start: [id: string];
  stop: [id: string];
  restart: [id: string];
  remove: [id: string];
  logs: [id: string];
  'open-folder': [id: string];
}>();

// 运行状态决定主按钮语义；过渡状态用于锁定可能冲突的进程操作。
const isRunning = computed(() => props.instance.status === 'running');
const isBusy = computed(
  () => props.instance.status === 'starting' || props.instance.status === 'stopping',
);

// v2 起平台信息存放在 platforms 字典中；卡片展示首个平台 ID 与 MoFox 本体安装目录。
const platformId = computed(() => Object.keys(props.instance.platforms ?? {})[0] ?? '');
const installPath = computed(() => props.instance.mofoxInstallDir);

// 启动和停止共用同一入口，保证状态切换期间不会重复派发操作。
function onPrimaryAction(): void {
  if (isBusy.value) return;
  if (isRunning.value) emit('stop', props.instance.id);
  else emit('start', props.instance.id);
}

function openPathConfiguration(): void {
  void router.push(`/instances/${encodeURIComponent(props.instance.id)}/paths`);
}
</script>

<template>
  <article class="instance-card">
    <!-- 实例名称与当前运行状态 -->
    <header class="instance-card__head">
      <h3 class="instance-card__name">{{ instance.name }}</h3>
      <StatusBadge :status="instance.status" />
    </header>

    <!-- 平台、版本及安装位置等实例元数据 -->
    <div class="instance-card__meta">
      <span class="instance-card__chip">{{ platformId }}</span>
      <span class="instance-card__version" :title="`v${instance.version}`">
        v{{ instance.version }}
      </span>
    </div>

    <p class="instance-card__path" :title="installPath">{{ installPath }}</p>

    <!-- 启动或停止期间展示不定进度，实际结果由上层状态更新驱动 -->
    <div v-if="isBusy" class="instance-card__progress" role="progressbar" aria-label="处理中">
      <div class="instance-card__progress-bar"></div>
    </div>

    <!-- 左侧为进程控制，右侧为实例辅助操作 -->
    <div class="instance-card__actions">
      <button
        v-if="isRunning"
        class="btn btn--tonal state-layer"
        type="button"
        :disabled="isBusy"
        @click="onPrimaryAction"
      >
        停止
      </button>
      <button
        v-else
        class="btn btn--filled state-layer"
        type="button"
        :disabled="isBusy"
        @click="onPrimaryAction"
      >
        启动
      </button>

      <button
        v-if="isRunning"
        class="icon-btn state-layer"
        type="button"
        title="重启"
        aria-label="重启"
        :disabled="isBusy"
        @click="emit('restart', instance.id)"
      >
        <span class="msr" aria-hidden="true">restart_alt</span>
      </button>

      <span class="instance-card__spacer"></span>

      <button
        class="icon-btn state-layer"
        type="button"
        title="查看日志"
        aria-label="查看日志"
        @click="emit('logs', instance.id)"
      >
        <span class="msr" aria-hidden="true">terminal</span>
      </button>
      <button
        class="icon-btn state-layer"
        type="button"
        title="配置路径"
        aria-label="配置路径"
        @click.stop.prevent="openPathConfiguration"
      >
        <span class="msr" aria-hidden="true">settings</span>
      </button>
      <button
        class="icon-btn state-layer"
        type="button"
        title="打开目录"
        aria-label="打开目录"
        @click="emit('open-folder', instance.id)"
      >
        <span class="msr" aria-hidden="true">folder_open</span>
      </button>
      <button
        class="icon-btn state-layer"
        type="button"
        title="导出整合包"
        aria-label="导出整合包"
        @click="exportOpen = true"
      >
        <span class="msr" aria-hidden="true">archive</span>
      </button>
      <button
        class="icon-btn state-layer"
        type="button"
        title="删除"
        aria-label="删除"
        @click="emit('remove', instance.id)"
      >
        <span class="msr" aria-hidden="true">delete</span>
      </button>
    </div>
  </article>

  <ExportPackDialog :instance="instance" :open="exportOpen" @close="exportOpen = false" />
</template>

<style scoped>
/* 卡片容器与悬停反馈 */
.instance-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--app-glass-border);
  border-radius: 20px;
  background: var(--md-sys-color-surface-container-low);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

@media (hover: hover) and (pointer: fine) {
  .instance-card:hover {
    box-shadow: var(--app-glass-card-shadow-hover);
  }
}

/* 标题与状态区 */
.instance-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.instance-card__name {
  margin: 0;
  font: var(--md-sys-typescale-title-medium);
  min-width: 0;
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 平台、版本和安装路径 */
.instance-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.instance-card__chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface-variant);
  flex: none;
  font: var(--md-sys-typescale-label-small);
}

.instance-card__version {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-card__path {
  margin: 0;
  font: var(--md-sys-typescale-body-small);
  font-family: var(--md-ref-typeface-mono);
  color: var(--md-sys-color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态切换时的不定进度动画 */
.instance-card__progress {
  height: 3px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-tertiary) 24%, transparent);
  overflow: hidden;
}

.instance-card__progress-bar {
  width: 40%;
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-tertiary);
  animation: instance-card-indeterminate 1.2s linear infinite;
}

@keyframes instance-card-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}

/* 进程控制与辅助操作按钮 */
.instance-card__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.instance-card__spacer {
  flex: 1;
}

.btn {
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition: box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--tonal {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
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

@media (prefers-reduced-motion: reduce) {
  .instance-card {
    transition:
      background-color var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard),
      box-shadow var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .instance-card__progress-bar {
    animation: none;
    opacity: 0.65;
  }
}
</style>
