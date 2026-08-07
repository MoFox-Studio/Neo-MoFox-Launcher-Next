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
  <div class="shell">
    <WallpaperLayer />
    <div class="shell__foreground">
      <!-- 应用窗体栏与主导航框架始终位于壁纸层上方。 -->
      <AppTitleBar />
      <div class="shell__body">
        <NavRail v-if="!bare" />
        <main class="shell__content">
          <router-view v-slot="{ Component }">
            <transition name="page">
              <component :is="Component" />
            </transition>
          </router-view>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  /* 透明：让标题栏与导航栏所在列露出系统材质或壁纸。 */
  background: transparent;
}

.shell__foreground {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.shell__body {
  flex: 1;
  display: flex;
  min-height: 0;
  background: transparent;
}

/* 主内容画布保持直角，避免内嵌侧栏右上角出现不连续的圆角。 */
.shell__content {
  flex: 1;
  min-width: 0;
  background: color-mix(
    in srgb,
    var(--md-sys-color-surface) calc(var(--app-wallpaper-content-opacity) * 100%),
    transparent
  );
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/*
 * 仅淡入路由页面。此前的 translateY 会为 SettingsView 和 InstallWizardView
 * 创建变换祖先，Chromium 会在入场动画结束后才稳定合成其 backdrop-filter。
 */
.page-enter-active {
  transition: opacity var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.page-enter-from {
  opacity: 0;
}


@media (prefers-reduced-motion: reduce) {
  .page-enter-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

}
</style>
