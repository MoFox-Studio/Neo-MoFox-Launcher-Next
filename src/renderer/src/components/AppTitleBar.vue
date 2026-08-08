<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { mofoxApi } from '@/services/mofox-api';

// Electron 窗口控制栏，监听主进程推送的最大化状态。
const maximized = ref(false);
let unsubscribe: (() => void) | undefined;

// 初始化窗口状态并在卸载时清理事件订阅。
onMounted(async () => {
  maximized.value = await mofoxApi.windowIsMaximized();
  unsubscribe = mofoxApi.on('window-maximize-changed', (value) => {
    maximized.value = value;
  });
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <header class="titlebar">
    <!-- 品牌区与原生窗口控制按钮 -->
    <div class="titlebar__brand">
      <span class="msr msr--fill titlebar__logo" aria-hidden="true">pets</span>
      <span class="titlebar__name">Neo-MoFox Launcher</span>
    </div>

    <div class="titlebar__controls">
      <button
        class="titlebar__btn state-layer"
        type="button"
        aria-label="最小化"
        @click="mofoxApi.windowMinimize()"
      >
        <span class="msr" aria-hidden="true">remove</span>
      </button>
      <button
        class="titlebar__btn state-layer"
        type="button"
        :aria-label="maximized ? '还原' : '最大化'"
        @click="mofoxApi.windowToggleMaximize()"
      >
        <span class="msr" aria-hidden="true">{{
          maximized ? 'select_window_2' : 'crop_square'
        }}</span>
      </button>
      <button
        class="titlebar__btn titlebar__btn--close state-layer"
        type="button"
        aria-label="关闭"
        @click="mofoxApi.windowClose()"
      >
        <span class="msr" aria-hidden="true">close</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
/* 可拖拽标题栏与不可拖拽的窗口控制区 */
.titlebar {
  height: var(--app-titlebar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 16px;
  -webkit-app-region: drag;
  color: var(--md-sys-color-on-surface-variant);
  /* 与侧栏共用半透明表面，既透出系统材质也保证品牌与控件可读性。 */
  background: var(--app-glass-surface);
  border-bottom: 1px solid var(--app-glass-border);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.titlebar__brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.titlebar__logo {
  font-size: 18px;
  color: var(--md-sys-color-primary);
}

.titlebar__name {
  font: var(--md-sys-typescale-label-medium);
  letter-spacing: 0.04em;
}

.titlebar__controls {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.titlebar__btn {
  width: 46px;
  height: 100%;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: inherit;
  cursor: default;
}

.titlebar__btn .msr {
  font-size: 18px;
}

.titlebar__btn--close:hover {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

@media (prefers-reduced-motion: reduce) {
  .titlebar__btn {
    transition: background-color var(--md-sys-motion-duration-short2)
      var(--md-sys-motion-easing-standard);
  }

  .titlebar__btn:active {
    transform: none;
  }
}
</style>
