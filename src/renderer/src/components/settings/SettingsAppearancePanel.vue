<script setup lang="ts">
// 外观面板：主题、颜色、壁纸与布局设置，直接绑定设置仓库并实时预览主题方案。
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import type {
  AppearanceDensity,
  LauncherSettings,
  MotionPreference,
  NavigationPosition,
  NavigationStyle,
  PaletteStyle,
  ThemeColorSource,
  ThemeContrast,
  ThemeMode,
} from '@shared/domain/settings';
import { MofoxError } from '@shared/domain/error';
import { useSettingsStore } from '@/stores/settings';
import { buildThemeScheme, resolveDark } from '@/services/theme';
import { mofoxApi } from '@/services/mofox-api';
import {
  clearWallpaperColors,
  extractColorsFromImage,
  loadWallpaperColors,
  saveWallpaperColors,
} from '@/utils/wallpaper-color-manager';
import { extractFirstFrameAsFile } from '@/utils/video-frame-extractor';
import { getWallpaperMediaUrl, loadWallpaperFile } from '@/utils/wallpaper-media';

const settingsStore = useSettingsStore();
const { settings, effectiveSeedColor, systemAccentColor } = storeToRefs(settingsStore);

const themeModes: Array<{ id: ThemeMode; label: string; icon: string }> = [
  { id: 'system', label: '跟随系统', icon: 'brightness_auto' },
  { id: 'light', label: '浅色', icon: 'light_mode' },
  { id: 'dark', label: '深色', icon: 'dark_mode' },
];

const colorSources: Array<{
  id: ThemeColorSource;
  label: string;
  description: string;
  icon: string;
}> = [
  { id: 'manual', label: '手动颜色', description: '使用自选种子色', icon: 'colorize' },
  { id: 'wallpaper', label: '壁纸取色', description: '跟随所选壁纸颜色', icon: 'wallpaper' },
  { id: 'system', label: '系统强调色', description: '跟随操作系统颜色', icon: 'desktop_windows' },
];

const paletteStyles: Array<{
  id: PaletteStyle;
  label: string;
  description: string;
}> = [
  { id: 'tonal-spot', label: 'Tonal Spot', description: '均衡柔和' },
  { id: 'neutral', label: 'Neutral', description: '低饱和中性' },
  { id: 'vibrant', label: 'Vibrant', description: '鲜明高彩度' },
  { id: 'expressive', label: 'Expressive', description: '活跃撞色' },
  { id: 'rainbow', label: 'Rainbow', description: '多彩协调' },
  { id: 'fruit-salad', label: 'Fruit Salad', description: '清爽邻近色' },
  { id: 'monochrome', label: 'Monochrome', description: '纯净黑白' },
  { id: 'fidelity', label: 'Fidelity', description: '忠于种子色' },
  { id: 'content', label: 'Content', description: '内容导向' },
];

const contrastOptions: Array<{ id: ThemeContrast; label: string }> = [
  { id: 'standard', label: '标准' },
  { id: 'medium', label: '增强' },
  { id: 'high', label: '高对比度' },
];

const densityOptions: Array<{ id: AppearanceDensity; label: string; icon: string }> = [
  { id: 'compact', label: '紧凑', icon: 'density_small' },
  { id: 'comfortable', label: '标准', icon: 'density_medium' },
  { id: 'spacious', label: '宽松', icon: 'density_large' },
];

const motionOptions: Array<{ id: MotionPreference; label: string; description: string }> = [
  { id: 'system', label: '跟随系统', description: '遵循系统辅助功能设置' },
  { id: 'expressive', label: 'Expressive', description: '更有弹性的强调动效' },
  { id: 'reduced', label: '减弱', description: '保留轻量状态过渡' },
  { id: 'none', label: '关闭', description: '禁用动画和视频壁纸' },
];

const presetColors = [
  '#367BF0',
  '#6750A4',
  '#455D92',
  '#0061A4',
  '#006874',
  '#006A6A',
  '#386A20',
  '#4F6351',
  '#605D00',
  '#755B00',
  '#9C4400',
  '#B3261E',
  '#984061',
  '#8E495D',
  '#7D5260',
  '#725188',
  '#5D5F5F',
  '#3F6374',
];

const wallpaperBusy = ref(false);
const wallpaperError = ref<string | null>(null);
const wallpaperColors = ref(loadWallpaperColors() ?? []);

const hasWallpaper = computed(
  () => settings.value.wallpaperType !== 'none' && settings.value.wallpaperFileName !== '',
);
const hasWallpaperColor = computed(() =>
  Boolean(settings.value.wallpaperSeedColor || wallpaperColors.value[0]),
);
const wallpaperMediaUrl = computed(() => getWallpaperMediaUrl(settings.value.wallpaperFileName));
const isDark = computed(() => resolveDark(settings.value.themeMode));

const palettePreviews = computed(() =>
  paletteStyles.map((option) => {
    const scheme = buildThemeScheme(
      effectiveSeedColor.value,
      isDark.value,
      option.id,
      settings.value.themeContrast,
    );
    return {
      ...option,
      colors: {
        surface: scheme.surfaceContainer,
        primary: scheme.primary,
        onPrimary: scheme.onPrimary,
        primaryContainer: scheme.primaryContainer,
        secondaryContainer: scheme.secondaryContainer,
        tertiaryContainer: scheme.tertiaryContainer,
      },
    };
  }),
);

function update(patch: Partial<LauncherSettings>): void {
  void settingsStore.update(patch);
}

function describeError(error: unknown): string {
  if (error instanceof MofoxError || error instanceof Error) return error.message;
  return '未知错误';
}

function sourceAvailable(source: ThemeColorSource): boolean {
  if (source === 'wallpaper') return hasWallpaperColor.value;
  if (source === 'system') return systemAccentColor.value !== null;
  return true;
}

function selectColorSource(source: ThemeColorSource): void {
  if (!sourceAvailable(source)) return;
  if (source === 'wallpaper' && !settings.value.wallpaperSeedColor) {
    const firstColor = wallpaperColors.value[0];
    if (firstColor) {
      update({ themeColorSource: source, wallpaperSeedColor: firstColor });
      return;
    }
  }
  update({ themeColorSource: source });
}

function setManualColor(color: string): void {
  update({ seedColor: color.toUpperCase(), themeColorSource: 'manual' });
}

function applyWallpaperColor(color: string): void {
  update({ wallpaperSeedColor: color.toUpperCase(), themeColorSource: 'wallpaper' });
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
    if (colors[0]) await settingsStore.update({ wallpaperSeedColor: colors[0].toUpperCase() });
  } catch (error) {
    wallpaperError.value = describeError(error);
  } finally {
    if (assetId) {
      try {
        await mofoxApi.discardWallpaper(assetId);
      } catch {
        // 暂存清理失败不覆盖原始导入错误。
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

function updateRange(
  key: 'wallpaperBlur' | 'wallpaperDim' | 'wallpaperOpacity',
  event: Event,
  minimum: number,
  maximum: number,
): void {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value) && value >= minimum && value <= maximum) update({ [key]: value });
}

function onLanguageChange(event: Event): void {
  update({ language: (event.target as HTMLSelectElement).value as LauncherSettings['language'] });
}
</script>

<template>
  <section class="settings-group">
    <!-- 颜色与主题 -->
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">palette</span>
        <div>
          <h2>颜色与主题</h2>
          <p>由种子色生成完整的 Material 3 配色</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">brightness_auto</span>
          <div class="settings-item__body">
            <span class="settings-item__label">主题模式</span>
            <span class="settings-item__desc">选择明暗外观</span>
          </div>
          <div class="choice-segment" role="radiogroup" aria-label="主题模式">
            <button
              v-for="option in themeModes"
              :key="option.id"
              class="choice-segment__button state-layer"
              :class="{ 'choice-segment__button--selected': settings.themeMode === option.id }"
              type="button"
              role="radio"
              :aria-checked="settings.themeMode === option.id"
              @click="update({ themeMode: option.id })"
            >
              <span class="msr">{{ option.icon }}</span>
              <span>{{ option.label }}</span>
            </button>
          </div>
        </div>

        <div class="settings-item settings-item--stack">
          <span class="msr settings-item__icon">colorize</span>
          <div class="settings-item__body">
            <span class="settings-item__label">颜色来源</span>
            <span class="settings-item__desc">当前 {{ effectiveSeedColor.toUpperCase() }}</span>
            <div class="source-grid" role="radiogroup" aria-label="主题颜色来源">
              <button
                v-for="source in colorSources"
                :key="source.id"
                class="source-option state-layer"
                :class="{ 'source-option--selected': settings.themeColorSource === source.id }"
                type="button"
                role="radio"
                :aria-checked="settings.themeColorSource === source.id"
                :disabled="!sourceAvailable(source.id)"
                @click="selectColorSource(source.id)"
              >
                <span class="msr source-option__icon">{{ source.icon }}</span>
                <span class="source-option__copy">
                  <strong>{{ source.label }}</strong>
                  <small>{{ source.description }}</small>
                </span>
                <span
                  v-if="settings.themeColorSource === source.id"
                  class="msr source-option__check"
                >
                  check_circle
                </span>
              </button>
            </div>
            <p v-if="!systemAccentColor" class="inline-note">
              <span class="msr">info</span> 当前平台未提供系统强调色，已自动使用手动颜色兜底。
            </p>
          </div>
        </div>

        <!-- 颜色来源切换时直接替换区块，不做过渡动画，避免进出同时发生引起闪跳。 -->
        <div
          v-if="settings.themeColorSource === 'manual'"
          class="settings-item settings-item--stack"
        >
          <span class="msr settings-item__icon">format_color_fill</span>
          <div class="settings-item__body">
            <span class="settings-item__label">手动种子色</span>
            <span class="settings-item__desc">{{ settings.seedColor.toUpperCase() }}</span>
            <div class="seed-colors">
              <button
                v-for="color in presetColors"
                :key="color"
                class="seed-color state-layer"
                :class="{ 'seed-color--selected': settings.seedColor.toUpperCase() === color }"
                :style="{ background: color }"
                type="button"
                :aria-label="`选择颜色 ${color}`"
                :aria-pressed="settings.seedColor.toUpperCase() === color"
                @click="setManualColor(color)"
              >
                <span v-if="settings.seedColor.toUpperCase() === color" class="msr">check</span>
              </button>
              <label class="seed-color seed-color--custom" title="自定义颜色">
                <span class="msr">colorize</span>
                <input
                  type="color"
                  :value="settings.seedColor"
                  aria-label="自定义主题色"
                  @input="setManualColor(($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>
          </div>
        </div>

        <div
          v-if="settings.themeColorSource === 'wallpaper'"
          class="settings-item settings-item--stack"
        >
          <span class="msr settings-item__icon">photo_library</span>
          <div class="settings-item__body">
            <span class="settings-item__label">壁纸取色盘</span>
            <span class="settings-item__desc">{{
              settings.wallpaperSeedColor
                ? settings.wallpaperSeedColor.toUpperCase()
                : '取自当前壁纸'
            }}</span>
            <div v-if="wallpaperColors.length" class="seed-colors">
              <button
                v-for="(color, index) in wallpaperColors"
                :key="color"
                class="seed-color state-layer"
                :class="{
                  'seed-color--selected':
                    settings.wallpaperSeedColor.toUpperCase() === color.toUpperCase(),
                }"
                :style="{ background: color }"
                type="button"
                :aria-label="`采用壁纸颜色 ${index + 1}: ${color}`"
                :aria-pressed="settings.wallpaperSeedColor.toUpperCase() === color.toUpperCase()"
                @click="applyWallpaperColor(color)"
              >
                <span
                  v-if="settings.wallpaperSeedColor.toUpperCase() === color.toUpperCase()"
                  class="msr"
                  >check</span
                >
              </button>
            </div>
            <p v-else class="inline-note">
              <span class="msr">info</span> 导入或更换壁纸后，这里会给出壁纸的取色结果。
            </p>
          </div>
        </div>

        <div class="settings-item settings-item--stack">
          <span class="msr settings-item__icon">style</span>
          <div class="settings-item__body">
            <span class="settings-item__label">调色板风格</span>
            <span class="settings-item__desc">九种 Material 动态方案</span>
            <div class="palette-grid" role="radiogroup" aria-label="调色板风格">
              <button
                v-for="preview in palettePreviews"
                :key="preview.id"
                class="palette-option state-layer"
                :class="{ 'palette-option--selected': settings.paletteStyle === preview.id }"
                :style="{ background: preview.colors.surface }"
                type="button"
                role="radio"
                :aria-checked="settings.paletteStyle === preview.id"
                @click="update({ paletteStyle: preview.id })"
              >
                <span class="palette-option__preview">
                  <span :style="{ background: preview.colors.primaryContainer }"></span>
                  <span :style="{ background: preview.colors.secondaryContainer }"></span>
                  <span :style="{ background: preview.colors.tertiaryContainer }"></span>
                  <span
                    v-if="settings.paletteStyle === preview.id"
                    class="palette-option__check msr"
                    :style="{
                      background: preview.colors.primary,
                      color: preview.colors.onPrimary,
                    }"
                    >check</span
                  >
                </span>
                <span class="palette-option__copy">
                  <strong>{{ preview.label }}</strong>
                  <small>{{ preview.description }}</small>
                </span>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">contrast</span>
          <div class="settings-item__body">
            <span class="settings-item__label">颜色对比度</span>
            <span class="settings-item__desc">提高文字与表面的可辨识度</span>
          </div>
          <div class="choice-segment" role="radiogroup" aria-label="颜色对比度">
            <button
              v-for="option in contrastOptions"
              :key="option.id"
              class="choice-segment__button state-layer"
              :class="{ 'choice-segment__button--selected': settings.themeContrast === option.id }"
              type="button"
              role="radio"
              :aria-checked="settings.themeContrast === option.id"
              @click="update({ themeContrast: option.id })"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 背景与表面 -->
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">wallpaper</span>
        <div>
          <h2>背景与表面</h2>
          <p>分别控制壁纸模糊、压暗层和内容表面透明度</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">add_photo_alternate</span>
          <div class="settings-item__body">
            <span class="settings-item__label">应用壁纸</span>
            <span class="settings-item__desc">
              JPG、PNG、WebP 不超过 10 MiB；MP4、WebM 不超过 50 MiB
            </span>
          </div>
          <div class="wallpaper-actions">
            <button
              class="text-button state-layer"
              type="button"
              :disabled="wallpaperBusy"
              @click="selectWallpaper"
            >
              {{ wallpaperBusy ? '正在导入' : hasWallpaper ? '更换' : '选择壁纸' }}
            </button>
            <button
              v-if="hasWallpaper"
              class="icon-action icon-action--danger state-layer"
              type="button"
              aria-label="删除壁纸"
              :disabled="wallpaperBusy"
              @click="removeWallpaper"
            >
              <span class="msr">delete</span>
            </button>
          </div>
        </div>

        <div v-if="wallpaperError" class="settings-note settings-note--error">
          <span class="msr settings-note__icon">error</span>
          <span>{{ wallpaperError }}</span>
        </div>

        <div class="settings-item settings-item--stack">
          <span class="msr settings-item__icon">wallpaper</span>
          <div class="settings-item__body">
            <span class="settings-item__label">壁纸预览</span>
            <span class="settings-item__desc">实时呈现模糊、压暗与内容表面效果</span>
            <div class="wallpaper-preview" :class="{ 'wallpaper-preview--empty': !hasWallpaper }">
              <img
                v-if="hasWallpaper && settings.wallpaperType === 'image'"
                :src="wallpaperMediaUrl"
                :style="{ filter: `blur(${settings.wallpaperBlur}px)` }"
                alt="当前壁纸预览"
              />
              <video
                v-else-if="hasWallpaper && settings.wallpaperType === 'video'"
                :src="wallpaperMediaUrl"
                :style="{ filter: `blur(${settings.wallpaperBlur}px)` }"
                muted
                autoplay
                loop
                playsinline
                preload="metadata"
              />
              <div v-else class="wallpaper-preview__empty">
                <span class="msr">add_photo_alternate</span>
                <span>选择图片或视频作为启动器背景</span>
              </div>
              <div
                v-if="hasWallpaper"
                class="wallpaper-preview__dim"
                :style="{ opacity: settings.wallpaperDim }"
              ></div>
              <div
                v-if="hasWallpaper"
                class="wallpaper-preview__surface"
                :style="{ opacity: settings.wallpaperOpacity }"
              >
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">blur_on</span>
          <div class="settings-item__body">
            <span class="settings-item__label">壁纸模糊</span>
            <span class="settings-item__desc">只模糊媒体层</span>
          </div>
          <div class="range-control">
            <input
              type="range"
              min="0"
              max="20"
              step="1"
              :value="settings.wallpaperBlur"
              :disabled="!hasWallpaper || wallpaperBusy"
              aria-label="壁纸模糊"
              @input="updateRange('wallpaperBlur', $event, 0, 20)"
            />
            <output>{{ settings.wallpaperBlur }} px</output>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">dark_mode</span>
          <div class="settings-item__body">
            <span class="settings-item__label">背景压暗</span>
            <span class="settings-item__desc">增加黑色遮罩</span>
          </div>
          <div class="range-control">
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.05"
              :value="settings.wallpaperDim"
              :disabled="!hasWallpaper || wallpaperBusy"
              aria-label="背景压暗"
              @input="updateRange('wallpaperDim', $event, 0, 0.8)"
            />
            <output>{{ Math.round(settings.wallpaperDim * 100) }}%</output>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">layers</span>
          <div class="settings-item__body">
            <span class="settings-item__label">内容表面</span>
            <span class="settings-item__desc">控制前景不透明度</span>
          </div>
          <div class="range-control">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              :value="settings.wallpaperOpacity"
              :disabled="!hasWallpaper || wallpaperBusy"
              aria-label="内容表面"
              @input="updateRange('wallpaperOpacity', $event, 0, 1)"
            />
            <output>{{ Math.round(settings.wallpaperOpacity * 100) }}%</output>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">blur</span>
          <div class="settings-item__body">
            <span class="settings-item__label">系统模糊效果</span>
            <span class="settings-item__desc">
              无壁纸时启用 Mica 与系统原生模糊材质；关闭后使用纯色背景
            </span>
          </div>
          <div
            class="md-switch"
            role="switch"
            :aria-checked="settings.systemBackdrop"
            :class="{ 'md-switch--checked': settings.systemBackdrop }"
            @click="update({ systemBackdrop: !settings.systemBackdrop })"
          >
            <div class="md-switch__thumb"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- 布局与动态效果 -->
    <section class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">dashboard_customize</span>
        <div>
          <h2>布局与动态效果</h2>
          <p>调整主导航、内容密度和全局动画节奏</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">swap_horiz</span>
          <div class="settings-item__body">
            <span class="settings-item__label">导航位置</span>
            <span class="settings-item__desc">在侧边栏和底栏之间切换</span>
          </div>
          <div class="visual-choice" role="radiogroup" aria-label="导航位置">
            <button
              v-for="option in [
                { id: 'side', label: '侧边', icon: 'left_panel_open' },
                { id: 'bottom', label: '底部', icon: 'bottom_panel_open' },
              ] as Array<{ id: NavigationPosition; label: string; icon: string }>"
              :key="option.id"
              class="visual-choice__button state-layer"
              :class="{
                'visual-choice__button--selected': settings.navigationPosition === option.id,
              }"
              type="button"
              role="radio"
              :aria-checked="settings.navigationPosition === option.id"
              @click="update({ navigationPosition: option.id })"
            >
              <span class="msr">{{ option.icon }}</span
              >{{ option.label }}
            </button>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">web_asset</span>
          <div class="settings-item__body">
            <span class="settings-item__label">导航表面</span>
            <span class="settings-item__desc">贴边显示，或使用与窗口分离的居中胶囊</span>
          </div>
          <div class="visual-choice" role="radiogroup" aria-label="导航表面">
            <button
              v-for="option in [
                { id: 'standard', label: '标准', icon: 'web_asset' },
                { id: 'floating', label: '悬浮', icon: 'select_window' },
              ] as Array<{ id: NavigationStyle; label: string; icon: string }>"
              :key="option.id"
              class="visual-choice__button state-layer"
              :class="{ 'visual-choice__button--selected': settings.navigationStyle === option.id }"
              type="button"
              role="radio"
              :aria-checked="settings.navigationStyle === option.id"
              @click="update({ navigationStyle: option.id })"
            >
              <span class="msr">{{ option.icon }}</span
              >{{ option.label }}
            </button>
          </div>
        </div>

        <div class="settings-item settings-item--stack">
          <span class="msr settings-item__icon">density_medium</span>
          <div class="settings-item__body">
            <span class="settings-item__label">界面密度</span>
            <span class="settings-item__desc">调整列表与内容的紧凑程度</span>
            <div class="density-grid" role="radiogroup" aria-label="界面密度">
              <button
                v-for="option in densityOptions"
                :key="option.id"
                class="density-option state-layer"
                :class="{ 'density-option--selected': settings.appearanceDensity === option.id }"
                type="button"
                role="radio"
                :aria-checked="settings.appearanceDensity === option.id"
                @click="update({ appearanceDensity: option.id })"
              >
                <span class="msr">{{ option.icon }}</span>
                <strong>{{ option.label }}</strong>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-item settings-item--stack">
          <span class="msr settings-item__icon">animation</span>
          <div class="settings-item__body">
            <span class="settings-item__label">动态效果</span>
            <span class="settings-item__desc">全局动画与视频壁纸的表现</span>
            <div class="motion-grid" role="radiogroup" aria-label="动态效果">
              <button
                v-for="option in motionOptions"
                :key="option.id"
                class="motion-option state-layer"
                :class="{ 'motion-option--selected': settings.motionPreference === option.id }"
                type="button"
                role="radio"
                :aria-checked="settings.motionPreference === option.id"
                @click="update({ motionPreference: option.id })"
              >
                <span>
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.description }}</small>
                </span>
                <span v-if="settings.motionPreference === option.id" class="msr">check_circle</span>
              </button>
            </div>
          </div>
        </div>

        <div class="settings-item">
          <span class="msr settings-item__icon">translate</span>
          <div class="settings-item__body">
            <span class="settings-item__label">界面语言</span>
            <span class="settings-item__desc">部分页面仍在持续完善本地化</span>
          </div>
          <select class="native-select" :value="settings.language" @change="onLanguageChange">
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped src="./settings-panel.css"></style>
<style scoped src="./SettingsAppearancePanel.css"></style>
