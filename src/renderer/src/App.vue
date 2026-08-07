<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppTitleBar from '@/components/AppTitleBar.vue';
import NavRail from '@/components/NavRail.vue';
import WallpaperLayer from '@/components/WallpaperLayer.vue';

const route = useRoute();
// 根据路由元数据切换首次引导的沉浸式布局。
const bare = computed(() => route.meta.bare === true);
</script>

<template>
  <div class="shell" :class="{ 'shell--bare': bare }">
    <WallpaperLayer />
    <div class="shell__foreground">
      <AppTitleBar />
      <div class="shell__body">
        <main class="shell__content">
          <router-view v-slot="{ Component }">
            <transition name="page" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </main>
        <NavRail v-if="!bare" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 42%, transparent);
  border-radius: var(--app-window-radius);
  background: color-mix(in srgb, var(--md-sys-color-surface) 76%, transparent);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.24),
    0 18px 48px rgb(20 18 24 / 0.16);
  backdrop-filter: blur(24px) saturate(145%);
  -webkit-backdrop-filter: blur(24px) saturate(145%);
}

.shell__foreground {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.shell__body {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
  flex-direction: column;
  background: transparent;
}

.shell__content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: transparent;
}

/*
 * 仅淡入路由页面。此前的 translateY 会为 SettingsView 和 InstallWizardView
 * 创建变换祖先，Chromium 会在入场动画结束后才稳定合成其 backdrop-filter。
 */
.page-enter-active {
  transition: opacity var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.page-leave-active {
  transition: opacity var(--md-sys-motion-duration-short2)
    var(--md-sys-motion-easing-emphasized-accelerate);
}

.page-enter-from {
  opacity: 0;
}

.page-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }
}
</style>
