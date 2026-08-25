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
// 设置与安装页自行分隔侧栏和内容画布，避免外层玻璃抹平侧栏背后的纹理。
const splitGlass = computed(() => route.meta.splitGlass === true);
// 仅有效的受管壁纸启用主内容遮罩，避免文件缺失时出现透明内容区。
const hasWallpaper = computed(
  () => settings.value.wallpaperType !== 'none' && settings.value.wallpaperFileName !== '',
);
// 遮罩拉满时玻璃侧栏与顶栏也转实，确保壁纸完全不可见。
const wallpaperAtMax = computed(() => hasWallpaper.value && settings.value.wallpaperOpacity >= 1);
</script>

<template>
  <div
    class="shell"
    :class="{
      'shell--has-wallpaper': hasWallpaper,
      'shell--wallpaper-max': wallpaperAtMax,
    }"
  >
    <WallpaperLayer />
    <div class="shell__foreground">
      <!-- 应用窗体栏与主导航框架始终位于壁纸层上方。 -->
      <AppTitleBar />
      <div class="shell__body">
        <NavRail v-if="!bare" />
        <main class="shell__content" :class="{ 'shell__content--split': splitGlass }">
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
  --app-current-content-surface: var(--app-shell-content-surface);
  --app-current-content-filter: blur(6px);

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
  /* 无壁纸时仅轻微露出桌面，避免主画布、标题栏和侧栏显得过透。 */
  background: var(--app-current-content-surface);
  backdrop-filter: var(--app-current-content-filter);
  -webkit-backdrop-filter: var(--app-current-content-filter);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.shell--has-wallpaper {
  /* 内容画布整面铺设遮罩驱动表面；遮罩归零时仍保留最低下限，保证内容可读。 */
  --app-current-content-surface: color-mix(
    in srgb,
    color-mix(in srgb, var(--md-sys-color-surface-container) 72%, var(--md-sys-color-background))
      max(
        calc(var(--app-wallpaper-content-opacity) * 100%),
        var(--app-wallpaper-content-min-opacity)
      ),
    transparent
  );
  --app-current-content-filter: none;
}

/* 遮罩 100% 时页面级玻璃转实（工具栏、卡片、内嵌侧栏），壁纸完全不可见；
   标题栏与主导航侧栏保持固定玻璃，不随遮罩变化。 */
.shell--wallpaper-max {
  --app-glass-card: var(--md-sys-color-surface-container);
  --app-glass-surface: var(--md-sys-color-surface);
  --app-subrail-surface: color-mix(
    in srgb,
    var(--md-sys-color-surface-dim) 94%,
    var(--md-sys-color-shadow)
  );
}

/* 分栏页面将玻璃层分别放到侧栏与右侧画布，确保两者读取真实的底层纹理。 */
.shell__content--split {
  background: transparent;
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
