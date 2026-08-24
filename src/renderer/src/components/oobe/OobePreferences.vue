<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import { mofoxApi } from '@/services/mofox-api';
import { MofoxError } from '@shared/domain/error';
import type { ThemeMode } from '@shared/domain/settings';
import {
  extractColorsFromImage,
  clearWallpaperColors,
  loadWallpaperColors,
  saveWallpaperColors,
} from '@/utils/wallpaper-color-manager';
import { extractFirstFrameAsFile } from '@/utils/video-frame-extractor';
import { getWallpaperMediaUrl, loadWallpaperFile } from '@/utils/wallpaper-media';

interface ThemeOption {
  value: ThemeMode;
  label: string;
  icon: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', label: '跟随系统', icon: 'routine' },
  { value: 'light', label: '浅色', icon: 'light_mode' },
  { value: 'dark', label: '深色', icon: 'dark_mode' },
];

const SEED_COLORS = ['#7C5CDB', '#B3261E', '#006A6A', '#9C4400', '#386A20', '#345CA8'];

const settingsStore = useSettingsStore();

const installDir = ref(settingsStore.settings.defaultInstallDir);

watch(
  () => settingsStore.settings.defaultInstallDir,
  (value) => {
    if (value !== installDir.value) installDir.value = value;
  },
);

const emit = defineEmits<{ (e: 'next'): void; (e: 'back'): void }>();

function selectTheme(mode: ThemeMode): void {
  void settingsStore.update({ themeMode: mode });
}

function selectSeed(color: string): void {
  void settingsStore.update({ seedColor: color });
}

function onInstallDirBlur(): void {
  void settingsStore.update({ defaultInstallDir: installDir.value });
}

// ─── 壁纸 ───────────────────────────────────────────────────────────────
// 与设置页保持一致的流程：主进程暂存 → 渲染层取色 → 提交为受管壁纸。
const wallpaperBusy = ref(false);
const wallpaperError = ref<string | null>(null);
const wallpaperColors = ref<string[]>(loadWallpaperColors() ?? []);

const hasWallpaper = computed(
  () =>
    settingsStore.settings.wallpaperType !== 'none' &&
    settingsStore.settings.wallpaperFileName !== '',
);

const wallpaperMediaUrl = computed(() =>
  getWallpaperMediaUrl(settingsStore.settings.wallpaperFileName),
);

function describeError(error: unknown): string {
  if (error instanceof MofoxError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}

async function selectWallpaper(): Promise<void> {
  if (wallpaperBusy.value) return;
  wallpaperBusy.value = true;
  wallpaperError.value = null;
  let assetId: string | undefined;
  try {
    const asset = await mofoxApi.selectWallpaper();
    if (!asset) return;
    assetId = asset.id;
    const sourceFile = await loadWallpaperFile(asset);
    const colorSource =
      asset.type === 'video' ? await extractFirstFrameAsFile(sourceFile) : sourceFile;
    const colors = await extractColorsFromImage(colorSource, 6);
    wallpaperColors.value = colors;
    saveWallpaperColors(colors);
    settingsStore.replace(await mofoxApi.commitWallpaper(asset.id));
    assetId = undefined;
    if (colors[0]) await settingsStore.update({ seedColor: colors[0] });
  } catch (error) {
    wallpaperError.value = describeError(error);
  } finally {
    if (assetId) {
      try {
        await mofoxApi.discardWallpaper(assetId);
      } catch {
        // 暂存清理失败不应掩盖原始导入错误。
      }
    }
    wallpaperBusy.value = false;
  }
}

async function removeWallpaper(): Promise<void> {
  if (wallpaperBusy.value || !hasWallpaper.value) return;
  wallpaperBusy.value = true;
  wallpaperError.value = null;
  try {
    settingsStore.replace(await mofoxApi.removeWallpaper());
    wallpaperColors.value = [];
    clearWallpaperColors();
  } catch (error) {
    wallpaperError.value = describeError(error);
  } finally {
    wallpaperBusy.value = false;
  }
}

function updateWallpaperBlur(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isInteger(value) && value >= 0 && value <= 20) {
    void settingsStore.update({ wallpaperBlur: value });
  }
}

function updateWallpaperOpacity(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value >= 0 && value <= 1) {
    void settingsStore.update({ wallpaperOpacity: value });
  }
}

function applyWallpaperColor(color: string): void {
  void settingsStore.update({ seedColor: color });
}
</script>

<template>
  <section class="oobe-step">
    <h2 class="oobe__step-title">偏好设置</h2>
    <p class="oobe__step-desc">配置主题外观与默认安装目录；这些选项稍后可在设置页修改</p>

    <div class="pref-block">
      <span class="pref-block__label">主题模式</span>
      <div class="segmented">
        <button
          v-for="(opt, idx) in THEME_OPTIONS"
          :key="opt.value"
          type="button"
          class="segmented__item state-layer"
          :class="{
            'segmented__item--selected': settingsStore.settings.themeMode === opt.value,
            'segmented__item--first': idx === 0,
            'segmented__item--last': idx === THEME_OPTIONS.length - 1,
          }"
          @click="selectTheme(opt.value)"
        >
          <span
            v-if="settingsStore.settings.themeMode === opt.value"
            class="msr segmented__check"
            aria-hidden="true"
            >check</span
          >
          <span class="msr" aria-hidden="true">{{ opt.icon }}</span>
          {{ opt.label }}
        </button>
      </div>
    </div>

    <div class="pref-block">
      <span class="pref-block__label">种子色</span>
      <div class="swatches">
        <button
          v-for="color in SEED_COLORS"
          :key="color"
          type="button"
          class="swatch"
          :class="{ 'swatch--selected': settingsStore.settings.seedColor === color }"
          :style="{ '--swatch-color': color }"
          :aria-label="`选择种子色 ${color}`"
          @click="selectSeed(color)"
        ></button>
      </div>
    </div>

    <div class="pref-block">
      <span class="pref-block__label">壁纸</span>
      <p class="pref-block__hint pref-block__hint--lead">
        支持 JPG、PNG、WebP、MP4 和 WebM，图片不超过 10 MiB，视频不超过 50
        MiB；可留空稍后在设置页配置。
      </p>

      <div class="wallpaper-preview" :class="{ 'wallpaper-preview--empty': !hasWallpaper }">
        <img
          v-if="hasWallpaper && settingsStore.settings.wallpaperType === 'image'"
          :src="wallpaperMediaUrl"
          alt="当前壁纸预览"
        />
        <video
          v-else-if="hasWallpaper && settingsStore.settings.wallpaperType === 'video'"
          :src="wallpaperMediaUrl"
          muted
          autoplay
          loop
          playsinline
          preload="metadata"
        />
        <div v-else class="wallpaper-preview__empty">
          <span class="msr" aria-hidden="true">wallpaper</span>
          <span>尚未选择壁纸</span>
        </div>
      </div>

      <div v-if="wallpaperError" class="wallpaper-error">
        <span class="msr" aria-hidden="true">error</span>
        <span>{{ wallpaperError }}</span>
      </div>

      <div class="wallpaper-actions">
        <button
          type="button"
          class="btn btn--filled state-layer"
          :disabled="wallpaperBusy"
          @click="selectWallpaper"
        >
          <span v-if="wallpaperBusy" class="spinner spinner--small" aria-hidden="true"></span>
          {{ wallpaperBusy ? '正在导入' : hasWallpaper ? '更换壁纸' : '选择壁纸' }}
        </button>
        <button
          v-if="hasWallpaper"
          type="button"
          class="btn btn--text state-layer"
          :disabled="wallpaperBusy"
          @click="removeWallpaper"
        >
          移除
        </button>
      </div>

      <div class="wallpaper-controls" :class="{ 'wallpaper-controls--disabled': !hasWallpaper }">
        <label class="wallpaper-slider">
          <span class="wallpaper-slider__label">模糊</span>
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            :value="settingsStore.settings.wallpaperBlur"
            :disabled="!hasWallpaper || wallpaperBusy"
            @input="updateWallpaperBlur"
          />
          <span class="wallpaper-slider__value">{{ settingsStore.settings.wallpaperBlur }} px</span>
        </label>
        <label class="wallpaper-slider">
          <span class="wallpaper-slider__label">内容遮罩</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="settingsStore.settings.wallpaperOpacity"
            :disabled="!hasWallpaper || wallpaperBusy"
            @input="updateWallpaperOpacity"
          />
          <span class="wallpaper-slider__value"
            >{{ Math.round(settingsStore.settings.wallpaperOpacity * 100) }}%</span
          >
        </label>
      </div>

      <div v-if="wallpaperColors.length" class="wallpaper-colors">
        <span class="wallpaper-colors__label">壁纸取色</span>
        <div class="wallpaper-colors__list">
          <button
            v-for="(color, index) in wallpaperColors"
            :key="color"
            class="wallpaper-color state-layer"
            :class="{
              'wallpaper-color--selected': settingsStore.settings.seedColor.toLowerCase() === color,
            }"
            :style="{ backgroundColor: color }"
            type="button"
            :title="`壁纸取色 ${index + 1}: ${color}`"
            @click="applyWallpaperColor(color)"
          ></button>
        </div>
      </div>
    </div>

    <div class="pref-block">
      <label class="field">
        <input
          v-model="installDir"
          class="field__input"
          type="text"
          placeholder=" "
          @blur="onInstallDirBlur"
        />
        <span class="field__label">默认安装目录</span>
      </label>
      <p class="pref-block__hint">实例默认安装到此目录下的子文件夹；可留空使用系统默认位置。</p>
    </div>

    <div class="pref-actions">
      <button type="button" class="btn btn--text state-layer" @click="emit('back')">上一步</button>
      <button type="button" class="btn btn--filled state-layer" @click="emit('next')">继续</button>
    </div>
  </section>
</template>

<style scoped>
.pref-block {
  margin-bottom: 28px;
}

.pref-block__label {
  display: block;
  font: var(--md-sys-typescale-title-small);
  margin-bottom: 12px;
}

.pref-block__hint {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  margin: 8px 0 0 16px;
}

.segmented {
  display: inline-flex;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--md-sys-color-outline);
  overflow: hidden;
}

.segmented__item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 16px;
  border: none;
  border-left: 1px solid var(--md-sys-color-outline);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.segmented__item--first {
  border-left: none;
}

.segmented__item--selected {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.segmented__check {
  font-size: 18px;
}

.swatches {
  display: flex;
  gap: 16px;
}

.swatch {
  width: 32px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  border: none;
  background: var(--swatch-color);
  cursor: pointer;
  box-shadow: 0 0 0 2px var(--md-sys-color-surface);
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition: outline-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.swatch--selected {
  outline-color: var(--md-sys-color-primary);
}

/* 引导页铺在纯 surface 上，浮动标签底色改为与之匹配，避免出现接缝。 */
.field__label {
  --field-label-background: var(--md-sys-color-surface);
}

.pref-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

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

.pref-block__hint--lead {
  margin: 0 0 12px;
}

.wallpaper-preview {
  position: relative;
  height: 164px;
  margin-bottom: 12px;
  overflow: hidden;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
}

.wallpaper-preview img,
.wallpaper-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wallpaper-preview--empty {
  background: color-mix(in srgb, var(--md-sys-color-surface-container-high) 72%, transparent);
}

.wallpaper-preview__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.wallpaper-preview__empty .msr {
  font-size: 28px;
}

.wallpaper-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-small);
}

.wallpaper-error .msr {
  font-size: 18px;
}

.wallpaper-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.wallpaper-controls {
  display: grid;
  gap: 12px;
  margin-bottom: 16px;
}

.wallpaper-controls--disabled {
  opacity: 0.5;
}

.wallpaper-slider {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) 48px;
  align-items: center;
  gap: 12px;
}

.wallpaper-slider__label {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
}

.wallpaper-slider input {
  width: 100%;
  accent-color: var(--md-sys-color-primary);
}

.wallpaper-slider__value {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  text-align: right;
  white-space: nowrap;
}

.wallpaper-colors {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.wallpaper-colors__label {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
}

.wallpaper-colors__list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.wallpaper-color {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  cursor: pointer;
}

.wallpaper-color--selected {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 3px;
}

.spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--md-sys-color-on-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-on-primary);
  animation: spinner-spin 0.8s linear infinite;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }

  .field__label {
    transition: color 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }
}
</style>
