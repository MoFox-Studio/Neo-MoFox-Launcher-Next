<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';

// 通用 MD3 风格弹窗：负责遮罩、 Esc 关闭与进出动画，内容由插槽填充。
interface Props {
  open: boolean;
  title?: string;
  // 点击遮罩或按 Esc 是否允许关闭，默认 true。
  dismissible?: boolean;
  // 弹窗宽度，数字按 px 处理，默认 320。
  width?: string | number;
  // 是否展示默认的同意/关闭操作按钮，默认 true。
  showActions?: boolean;
  // 同意按钮文案，默认“同意”。
  confirmText?: string;
  // 关闭按钮文案，默认“关闭”。
  cancelText?: string;
  // 同意按钮是否可用，默认 true。
  confirmDisabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: undefined,
  dismissible: true,
  width: 320,
  showActions: true,
  confirmText: '同意',
  cancelText: '关闭',
  confirmDisabled: false,
});

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

function requestClose(): void {
  if (props.dismissible) emit('close');
}

function onConfirm(): void {
  emit('confirm');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) requestClose();
}

// 弹窗挂载期间监听 Esc，卸载或关闭时清理，避免泄漏监听器。
watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('keydown', onKeydown);
    else document.removeEventListener('keydown', onKeydown);
  },
);

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-scrim" @click.self="requestClose">
        <div
          class="dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          :style="{ width: typeof width === 'number' ? `${width}px` : width }"
        >
          <h2 v-if="title" class="dialog__title">{{ title }}</h2>
          <div v-if="$slots.default" class="dialog__body">
            <slot />
          </div>
          <div v-if="$slots.actions" class="dialog__actions">
            <slot name="actions" />
          </div>
          <div v-else-if="showActions" class="dialog__actions">
            <button
              class="btn btn--text state-layer"
              type="button"
              @click="requestClose"
            >
              {{ cancelText }}
            </button>
            <button
              class="btn btn--filled state-layer"
              type="button"
              :disabled="confirmDisabled"
              @click="onConfirm"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 遮罩层居中承载弹窗，点击空白区可由上层决定是否关闭 */
.dialog-scrim {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: color-mix(in srgb, var(--md-sys-color-scrim) 38%, transparent);
  backdrop-filter: blur(6px) saturate(110%);
  -webkit-backdrop-filter: blur(6px) saturate(110%);
  z-index: 1000;
}

/* MD3 基础弹窗容器：高对比表面、超大圆角与三级阴影 */
.dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 100%;
  max-height: calc(100dvh - 32px);
  padding: 24px;
  overflow: hidden;
  border: 1px solid var(--app-glass-highlight);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: color-mix(in srgb, var(--md-sys-color-surface-container-high) 78%, transparent);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.24),
    0 24px 64px rgb(20 18 24 / 0.28);
  backdrop-filter: blur(32px) saturate(165%);
  -webkit-backdrop-filter: blur(32px) saturate(165%);
}

.dialog__title {
  flex: none;
  margin: 0;
  font: var(--md-sys-typescale-headline-small);
  color: var(--md-sys-color-on-surface);
}

.dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  margin-inline: -8px;
  padding-inline: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.dialog__actions {
  flex: none;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

/* 与其他视图保持一致的按钮样式 */
.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  overflow: hidden;
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
  padding: 0 12px;
}

/* 弹窗进出：遮罩淡入淡出，内容缩放强调进出感 */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.dialog-enter-active .dialog,
.dialog-leave-active .dialog {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-medium2)
      var(--md-sys-motion-easing-emphasized-decelerate);
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}

.dialog-enter-from .dialog,
.dialog-leave-to .dialog {
  opacity: 0;
  transform: scale(0.9);
}

@media (max-width: 520px), (max-height: 560px) {
  .dialog-scrim {
    padding: 10px;
  }

  .dialog {
    max-height: calc(100dvh - 20px);
    padding: 20px;
    border-radius: var(--md-sys-shape-corner-large);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .dialog-scrim {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  .dialog {
    background: var(--md-sys-color-surface-container-high);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (prefers-contrast: more) {
  .dialog {
    border-color: var(--md-sys-color-outline);
    background: var(--md-sys-color-surface);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dialog-enter-active,
  .dialog-leave-active,
  .dialog-enter-active .dialog,
  .dialog-leave-active .dialog {
    transition: opacity var(--md-sys-motion-duration-short2)
      var(--md-sys-motion-easing-standard);
  }

  .dialog-enter-from .dialog,
  .dialog-leave-to .dialog {
    transform: none;
  }
}
</style>
