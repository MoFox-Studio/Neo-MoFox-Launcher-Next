<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '@/stores/settings';
import { getWallpaperMediaUrl } from '@/utils/wallpaper-media';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);
const videoPlaybackFailed = ref(false);
const prefersReducedMotion = ref(false);
let motionQuery: ReturnType<typeof window.matchMedia> | undefined;

/** 当前有效壁纸必须同时拥有类型和受管媒体文件名。 */
const hasWallpaper = computed(
  () => settings.value.wallpaperType !== 'none' && settings.value.wallpaperFileName !== '',
);

/** 媒体 URL 仅由主进程生成的受管文件名构造。 */
const mediaUrl = computed(() => getWallpaperMediaUrl(settings.value.wallpaperFileName));

/** 模糊会产生边缘，组件样式通过 24px 扩展媒体画布隐藏这些边缘。 */
const mediaStyle = computed(() => ({ filter: `blur(${settings.value.wallpaperBlur}px)` }));

/**
 * 内容遮罩仅调节壁纸状态下的前景表面，不会降低媒体自身的透明度。
 * 无壁纸时复位变量，避免切换状态后沿用旧的遮罩值。
 */
watchEffect(() => {
  document.documentElement.style.setProperty(
    '--app-wallpaper-content-opacity',
    hasWallpaper.value ? String(settings.value.wallpaperOpacity) : '1',
  );
});

watch(
  () => [settings.value.wallpaperType, settings.value.wallpaperFileName],
  () => {
    videoPlaybackFailed.value = false;
  },
);

/** 同步用户系统的减弱动态效果偏好，视频在该模式下不自动播放。 */
function syncMotionPreference(): void {
  prefersReducedMotion.value = motionQuery?.matches ?? false;
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  syncMotionPreference();
  motionQuery.addEventListener('change', syncMotionPreference);
});

onBeforeUnmount(() => {
  motionQuery?.removeEventListener('change', syncMotionPreference);
});
</script>

<template>
  <div v-if="hasWallpaper" class="wallpaper-layer" aria-hidden="true">
    <img
      v-if="settings.wallpaperType === 'image'"
      class="wallpaper-layer__media"
      :src="mediaUrl"
      :style="mediaStyle"
      alt=""
    />
    <video
      v-else-if="
        settings.wallpaperType === 'video' && !prefersReducedMotion && !videoPlaybackFailed
      "
      class="wallpaper-layer__media"
      :src="mediaUrl"
      :style="mediaStyle"
      autoplay
      loop
      muted
      playsinline
      preload="metadata"
      @error="videoPlaybackFailed = true"
    />
  </div>
</template>

<style scoped>
.wallpaper-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--md-sys-color-surface);
}

.wallpaper-layer__media {
  position: absolute;
  inset: -24px;
  width: calc(100% + 48px);
  height: calc(100% + 48px);
  object-fit: cover;
  transform: scale(1.04);
}

@media (prefers-reduced-motion: reduce) {
  .wallpaper-layer__media {
    filter: none !important;
  }
}
</style>
