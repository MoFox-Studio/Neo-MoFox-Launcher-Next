<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import AppTitleBar from '@/components/AppTitleBar.vue';
import AddInstanceDialog from '@/components/AddInstanceDialog.vue';
import NavRail from '@/components/NavRail.vue';
import WallpaperLayer from '@/components/WallpaperLayer.vue';
import { useSettingsStore } from '@/stores/settings';

const route = useRoute();
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);
// 根据路由元数据切换首次引导的沉浸式布局。
const bare = computed(() => route.meta.bare === true);
// 仅有效的受管壁纸启用主内容遮罩，避免文件缺失时出现透明内容区。
const hasWallpaper = computed(
  () => settings.value.wallpaperType !== 'none' && settings.value.wallpaperFileName !== '',
);
</script>

<template>
  <div class="shell" :class="{ 'shell--has-wallpaper': hasWallpaper }">
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
    <AddInstanceDialog v-if="!bare" />
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
  /* 无壁纸时保持较轻的底层玻璃，让内层设置侧栏等材质仍可分辨。 */
  background: color-mix(in srgb, var(--md-sys-color-surface) 52%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.shell--has-wallpaper .shell__content {
  /* 0 时完全透出壁纸；非零时混入主题容器色，让内容区更有承托感。 */
  background: color-mix(
    in srgb,
    color-mix(in srgb, var(--md-sys-color-surface-container) 72%, var(--md-sys-color-background))
      calc(var(--app-wallpaper-content-opacity) * 100%),
    transparent
  );
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/*
 * 仅淡入路由页面。此前的 translateY 会为 SettingsView 和 InstallWizard
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
