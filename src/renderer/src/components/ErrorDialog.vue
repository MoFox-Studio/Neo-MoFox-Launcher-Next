<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseDialog from './BaseDialog.vue';

// 错误弹窗：在通用弹窗之上提供错误图标、描述以及可展开的堆栈日志框。
interface Props {
  open: boolean;
  title?: string;
  // 给用户的可读错误描述。
  description?: string;
  // 原始堆栈、日志或诊断输出，展示在固定大小的日志框中。
  stack?: string;
  // 日志框折叠态高度，默认 160px。
  collapsedHeight?: number;
  // 日志框展开态高度，默认 360px。
  expandedHeight?: number;
  // 是否允许通过遮罩或 Esc 关闭，默认 true。
  dismissible?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: '发生错误',
  description: undefined,
  stack: undefined,
  collapsedHeight: 160,
  expandedHeight: 360,
  dismissible: true,
});

const emit = defineEmits<{
  close: [];
}>();

// 日志框默认折叠，避免长堆栈抢占弹窗视觉重心。
const expanded = ref(false);

// 每次打开时复位展开状态，保证多次复用时的初始体验一致。
watch(
  () => props.open,
  (open) => {
    if (open) expanded.value = false;
  },
);

// 折叠态下若日志过长则尾部淡出，提示用户可展开查看更多。
const logboxStyle = computed(() => ({
  height: expanded.value ? `${props.expandedHeight}px` : `${props.collapsedHeight}px`,
}));

// 同步复制堆栈文本到剪贴板，失败时静默忽略以保证流程不中断。
async function copyStack(): Promise<void> {
  if (!props.stack) return;
  try {
    await navigator.clipboard.writeText(props.stack);
  } catch {
    /* 剪贴板不可用时忽略，避免阻塞关闭流程 */
  }
}

function toggleExpanded(): void {
  expanded.value = !expanded.value;
}

function onClose(): void {
  emit('close');
}
</script>

<template>
  <BaseDialog
    :open="open"
    :title="title"
    :dismissible="dismissible"
    :width="480"
    @close="onClose"
  >
    <!-- 头部：错误图标与可读描述 -->
    <div class="error-dialog__head">
      <span class="error-dialog__icon msr" aria-hidden="true">error</span>
      <p v-if="description" class="error-dialog__description">{{ description }}</p>
    </div>

    <!-- 仅在存在堆栈时展示日志框，避免空白区域 -->
    <div v-if="stack" class="error-dialog__log-wrap">
      <div class="error-dialog__logbar">
        <button
          class="error-dialog__log-toggle state-layer"
          type="button"
          :aria-expanded="expanded"
          @click="toggleExpanded"
        >
          <span class="msr error-dialog__log-toggle-icon" aria-hidden="true">
            {{ expanded ? 'expand_less' : 'expand_more' }}
          </span>
          <span>{{ expanded ? '收起堆栈' : '展开堆栈' }}</span>
        </button>
        <button
          class="error-dialog__copy state-layer"
          type="button"
          title="复制堆栈"
          aria-label="复制堆栈"
          @click="copyStack"
        >
          <span class="msr" aria-hidden="true">content_copy</span>
          <span>复制</span>
        </button>
      </div>
      <pre
        class="error-dialog__logbox"
        :class="{ 'error-dialog__logbox--collapsed': !expanded }"
        :style="logboxStyle"
      >{{ stack }}</pre>
    </div>

    <template #actions>
      <button class="btn btn--text state-layer" type="button" @click="onClose">关闭</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
/* 错误图标与描述的水平排版 */
.error-dialog__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.error-dialog__icon {
  font-size: 24px;
  color: var(--md-sys-color-error);
  flex-shrink: 0;
  margin-top: 2px;
}

.error-dialog__description {
  margin: 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface);
  word-break: break-word;
  white-space: pre-wrap;
}

/* 日志框容器：低层级表面与圆角，与正文形成视觉分层 */
.error-dialog__log-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.error-dialog__logbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.error-dialog__log-toggle,
.error-dialog__copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
  cursor: pointer;
}

.error-dialog__log-toggle:hover,
.error-dialog__copy:hover {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
}

.error-dialog__log-toggle-icon {
  font-size: 18px;
}

.error-dialog__copy .msr {
  font-size: 16px;
}

/* 等宽日志框：固定高度、内部滚动，折叠态保留底部淡出提示 */
.error-dialog__logbox {
  margin: 0;
  padding: 12px 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  font-family: var(--md-ref-typeface-mono);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  position: relative;
  transition: height var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.error-dialog__logbox--collapsed::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 24px;
  border-bottom-left-radius: var(--md-sys-shape-corner-medium);
  border-bottom-right-radius: var(--md-sys-shape-corner-medium);
  background: linear-gradient(
    to bottom,
    transparent,
    var(--md-sys-color-surface-container)
  );
  pointer-events: none;
}

/* 与其他视图保持一致的按钮样式 */
.btn {
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn--text {
  padding: 0 12px;
  background: transparent;
  color: var(--md-sys-color-primary);
}

@media (prefers-reduced-motion: reduce) {
  .error-dialog__logbox {
    transition: none;
  }
}
</style>
