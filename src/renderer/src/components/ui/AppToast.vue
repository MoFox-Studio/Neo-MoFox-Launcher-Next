<script setup lang="ts">
import { useToast } from '@/composables/use-toast';

// 全局轻提示宿主：挂在 App 根节点，任何模块调用 showToast 都会在这里渲染。
const { message, visible } = useToast();
</script>

<template>
  <transition name="app-toast">
    <div v-if="visible" class="app-toast" role="status">{{ message }}</div>
  </transition>
</template>

<style scoped>
/* 操作反馈提示：底部居中胶囊，位于弹窗之上保证任何层级下都能看到反馈。 */
.app-toast {
  position: fixed;
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
  z-index: 1100;
}

.app-toast-enter-active,
.app-toast-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.app-toast-enter-from,
.app-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .app-toast-enter-active,
  .app-toast-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .app-toast-enter-from,
  .app-toast-leave-to {
    transform: translateX(-50%);
  }
}
</style>
