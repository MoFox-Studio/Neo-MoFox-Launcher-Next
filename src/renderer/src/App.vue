<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import AppTitleBar from '@/components/layout/AppTitleBar.vue';
import NavRail from '@/components/layout/NavRail.vue';
import WallpaperLayer from '@/components/layout/WallpaperLayer.vue';
import DesktopBackdropLayer from '@/components/layout/DesktopBackdropLayer.vue';
import AppToast from '@/components/ui/AppToast.vue';
import AddInstanceDialog from '@/components/instance/AddInstanceDialog.vue';
import IntegrityCheckDialog from '@/components/instance/IntegrityCheckDialog.vue';
import { mofoxApi } from '@/services/mofox-api';
import { useIntegrityStore } from '@/stores/integrity';
import { useSettingsStore } from '@/stores/settings';
import { hasNativeBackdrop } from '@/utils/native-backdrop';

const route = useRoute();
const settingsStore = useSettingsStore();
const integrityStore = useIntegrityStore();
const { settings } = storeToRefs(settingsStore);
const windowMaximized = ref(false);
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

// 宿主是否自带窗口材质(Win11 Mica / macOS vibrancy);缺省假定有,避免 Win11 闪现兜底层。
const nativeBackdrop = ref(true);
// "系统模糊效果"开关关闭时原生材质已被主进程停用,此时不透明纯色兜底接管窗口背景。
const solidBackdrop = computed(() => !hasWallpaper.value && !settings.value.systemBackdrop);
// 开关开启但平台无原生材质时,由渲染端 CSS Mica 罩层接管窗口背景。
const cssMica = computed(
  () => !solidBackdrop.value && !hasWallpaper.value && !nativeBackdrop.value,
);

// 启动器启动时校验全部实例文件是否齐全，发现缺失项时弹窗询问删除或保留。
onMounted(async () => {
  nativeBackdrop.value = await hasNativeBackdrop();
  if (!settings.value.oobeCompleted) return;
  try {
    const issues = await mofoxApi.checkInstancesIntegrity();
    integrityStore.openWith(issues);
  } catch {
    /* 校验失败不阻断启动，由用户手动在实例管理页处理 */
  }
});
</script>

<template>
  <div
    class="shell"
    :class="{
      'shell--has-wallpaper': hasWallpaper,
      'shell--wallpaper-max': wallpaperAtMax,
      'shell--css-mica': cssMica,
      'shell--maximized': windowMaximized,
      'shell--nav-bottom': !bare && settings.navigationPosition === 'bottom',
      'shell--nav-floating': !bare && settings.navigationStyle === 'floating',
    }"
  >
    <DesktopBackdropLayer :active="cssMica" :solid="solidBackdrop" />
    <WallpaperLayer />
    <div class="shell__foreground">
      <!-- 应用窗体栏与主导航框架始终位于壁纸层上方。 -->
      <AppTitleBar @maximize-change="windowMaximized = $event" />
      <div class="shell__body">
        <div v-if="!bare" class="shell__navigation-slot">
          <NavRail
            class="shell__navigation"
            :position="settings.navigationPosition"
            :variant="settings.navigationStyle"
          />
        </div>
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
    <IntegrityCheckDialog />
    <!-- 全局轻提示：任何模块调用 showToast 都渲染到这里。 -->
    <AppToast />
  </div>
</template>

<style scoped>
.shell {
  --app-current-content-surface: var(--app-shell-content-surface);
  --app-current-content-filter: blur(6px);
  --app-nav-overlay-start-inset: 0px;
  --app-nav-overlay-bottom-inset: 0px;

  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--app-window-corner-radius);
  clip-path: inset(0 round var(--app-window-corner-radius));
  /* 透明：让标题栏与导航栏所在列露出系统材质或壁纸。 */
  background: transparent;
}

.shell--maximized {
  border-radius: 0;
  clip-path: none;
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
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
  background: transparent;
}

.shell--nav-bottom .shell__body {
  flex-direction: column;
}

.shell--nav-bottom .shell__content {
  order: 1;
  min-height: 0;
}

.shell--nav-bottom .shell__navigation-slot {
  order: 2;
}

.shell__navigation-slot {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 0 0 var(--app-navrail-width);
  min-width: 0;
  min-height: 0;
}

.shell__navigation {
  flex: 1;
}

.shell--nav-bottom .shell__navigation-slot {
  width: 100%;
  flex: 0 0 var(--app-nav-bottom-height);
}

/*
 * 悬浮导航是覆盖在内容之上的独立层，不参与 flex 排版。内容表面因此能一直铺到
 * 窗口边缘；安全区只作用于页面内容，不会再露出一条空的窗口底色。
 */
.shell--nav-floating .shell__navigation-slot {
  position: absolute;
  inset: 0 auto 0 0;
  width: 96px;
  height: auto;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 12px 8px;
  pointer-events: none;
}

.shell--nav-floating:not(.shell--nav-bottom) {
  --app-nav-overlay-start-inset: 96px;
}

.shell--nav-bottom.shell--nav-floating .shell__navigation-slot {
  inset: auto 0 0;
  width: auto;
  height: 84px;
  padding: 8px 12px 12px;
}

.shell--nav-bottom.shell--nav-floating {
  --app-nav-overlay-bottom-inset: 84px;
}

.shell--nav-floating .shell__navigation {
  flex: 0 0 auto;
  pointer-events: auto;
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
  --app-glass-row: var(--md-sys-color-surface-container);
  --app-glass-surface: var(--md-sys-color-surface);
  --app-subrail-surface: color-mix(
    in srgb,
    var(--md-sys-color-surface-dim) 94%,
    var(--md-sys-color-shadow)
  );
}

/*
 * CSS Mica 兜底激活时,罩层已承担底色职责;表面同步调整做补偿,
 * 否则两层不透明度相乘会把壁纸透出率压到 ~2%,观感退回纯色墙面。
 * 深色基准:罩层 65% 配内容 78%,总透出 ~8%;侧栏 70% 略透,保持呼吸感。
 * 浅色对比弱,单独放宽(见下方覆盖块)。
 */
.shell--css-mica {
  --app-shell-content-surface: color-mix(in srgb, var(--md-sys-color-surface) 78%, transparent);
  --app-shell-chrome-surface: color-mix(in srgb, var(--md-sys-color-surface) 70%, transparent);
}

:root[data-theme='light'] .shell--css-mica {
  --app-shell-content-surface: color-mix(in srgb, var(--md-sys-color-surface) 70%, transparent);
  --app-shell-chrome-surface: color-mix(in srgb, var(--md-sys-color-surface) 88%, transparent);
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
