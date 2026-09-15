<script setup lang="ts">
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
  '#7C5CDB',
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
  <section class="appearance-panel">
    <header class="appearance-panel__header">
      <div>
        <h2>个性化</h2>
        <p>颜色、背景、布局与动态效果会即时应用并自动保存。</p>
      </div>
      <div class="active-theme-chip">
        <span class="active-theme-chip__color" :style="{ background: effectiveSeedColor }"></span>
        <span>{{ paletteStyles.find((item) => item.id === settings.paletteStyle)?.label }}</span>
      </div>
    </header>

    <div class="appearance-stack">
      <section class="appearance-card">
        <div class="appearance-card__heading">
          <span class="msr">palette</span>
          <div>
            <h3>颜色与主题</h3>
            <p>由种子色生成完整的 Material 3 配色。</p>
          </div>
        </div>

        <div class="segmented-column">
          <div class="setting-row">
            <div class="setting-row__copy">
              <span class="setting-row__label">主题模式</span>
              <span class="setting-row__description">选择明暗外观</span>
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

          <div class="setting-block">
            <div class="setting-block__title">
              <span>颜色来源</span>
              <span class="setting-block__hint">当前 {{ effectiveSeedColor.toUpperCase() }}</span>
            </div>
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

          <Transition name="reveal">
            <div v-if="settings.themeColorSource === 'manual'" class="setting-block">
              <div class="setting-block__title">
                <span>手动种子色</span>
                <span class="setting-block__hint">{{ settings.seedColor.toUpperCase() }}</span>
              </div>
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
          </Transition>

          <div class="setting-block">
            <div class="setting-block__title">
              <span>调色板风格</span>
              <span class="setting-block__hint">九种 Material 动态方案</span>
            </div>
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

          <div class="setting-row">
            <div class="setting-row__copy">
              <span class="setting-row__label">颜色对比度</span>
              <span class="setting-row__description">提高文字与表面的可辨识度</span>
            </div>
            <div class="choice-segment" role="radiogroup" aria-label="颜色对比度">
              <button
                v-for="option in contrastOptions"
                :key="option.id"
                class="choice-segment__button state-layer"
                :class="{
                  'choice-segment__button--selected': settings.themeContrast === option.id,
                }"
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

      <section class="appearance-card">
        <div class="appearance-card__heading">
          <span class="msr">wallpaper</span>
          <div>
            <h3>背景与表面</h3>
            <p>分别控制壁纸模糊、压暗层和内容表面透明度。</p>
          </div>
        </div>

        <div class="segmented-column">
          <div class="setting-row setting-row--top">
            <div class="setting-row__copy">
              <span class="setting-row__label">应用壁纸</span>
              <span class="setting-row__description">
                JPG、PNG、WebP 不超过 10 MiB；MP4、WebM 不超过 50 MiB
              </span>
              <span v-if="wallpaperError" class="setting-row__error">{{ wallpaperError }}</span>
            </div>
            <div class="wallpaper-actions">
              <button
                class="text-action state-layer"
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

          <div class="wallpaper-block">
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

            <div
              class="wallpaper-sliders"
              :class="{ 'wallpaper-sliders--disabled': !hasWallpaper }"
            >
              <label class="range-row">
                <span class="range-row__icon msr">blur_on</span>
                <span class="range-row__copy"
                  ><strong>壁纸模糊</strong><small>只模糊媒体层</small></span
                >
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  :value="settings.wallpaperBlur"
                  :disabled="!hasWallpaper || wallpaperBusy"
                  @input="updateRange('wallpaperBlur', $event, 0, 20)"
                />
                <output>{{ settings.wallpaperBlur }} px</output>
              </label>
              <label class="range-row">
                <span class="range-row__icon msr">dark_mode</span>
                <span class="range-row__copy"
                  ><strong>背景压暗</strong><small>增加黑色遮罩</small></span
                >
                <input
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.05"
                  :value="settings.wallpaperDim"
                  :disabled="!hasWallpaper || wallpaperBusy"
                  @input="updateRange('wallpaperDim', $event, 0, 0.8)"
                />
                <output>{{ Math.round(settings.wallpaperDim * 100) }}%</output>
              </label>
              <label class="range-row">
                <span class="range-row__icon msr">layers</span>
                <span class="range-row__copy"
                  ><strong>内容表面</strong><small>控制前景不透明度</small></span
                >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  :value="settings.wallpaperOpacity"
                  :disabled="!hasWallpaper || wallpaperBusy"
                  @input="updateRange('wallpaperOpacity', $event, 0, 1)"
                />
                <output>{{ Math.round(settings.wallpaperOpacity * 100) }}%</output>
              </label>
            </div>

            <div v-if="wallpaperColors.length" class="wallpaper-palette">
              <span>壁纸调色板</span>
              <div>
                <button
                  v-for="(color, index) in wallpaperColors"
                  :key="color"
                  class="wallpaper-color state-layer"
                  :class="{
                    'wallpaper-color--selected':
                      settings.themeColorSource === 'wallpaper' &&
                      settings.wallpaperSeedColor.toUpperCase() === color.toUpperCase(),
                  }"
                  :style="{ background: color }"
                  type="button"
                  :aria-label="`采用壁纸颜色 ${index + 1}: ${color}`"
                  @click="applyWallpaperColor(color)"
                >
                  <span
                    v-if="
                      settings.themeColorSource === 'wallpaper' &&
                      settings.wallpaperSeedColor.toUpperCase() === color.toUpperCase()
                    "
                    class="msr"
                    >check</span
                  >
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="appearance-card">
        <div class="appearance-card__heading">
          <span class="msr">dashboard_customize</span>
          <div>
            <h3>布局与动态效果</h3>
            <p>调整主导航、内容密度和全局动画节奏。</p>
          </div>
        </div>

        <div class="segmented-column">
          <div class="setting-row">
            <div class="setting-row__copy">
              <span class="setting-row__label">导航位置</span>
              <span class="setting-row__description">在侧边栏和底栏之间切换</span>
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

          <div class="setting-row">
            <div class="setting-row__copy">
              <span class="setting-row__label">导航表面</span>
              <span class="setting-row__description">贴边显示，或使用与窗口分离的居中胶囊</span>
            </div>
            <div class="visual-choice" role="radiogroup" aria-label="导航表面">
              <button
                v-for="option in [
                  { id: 'standard', label: '标准', icon: 'web_asset' },
                  { id: 'floating', label: '悬浮', icon: 'select_window' },
                ] as Array<{ id: NavigationStyle; label: string; icon: string }>"
                :key="option.id"
                class="visual-choice__button state-layer"
                :class="{
                  'visual-choice__button--selected': settings.navigationStyle === option.id,
                }"
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

          <div class="setting-block">
            <div class="setting-block__title"><span>界面密度</span></div>
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

          <div class="setting-block">
            <div class="setting-block__title"><span>动态效果</span></div>
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

          <label class="setting-row">
            <div class="setting-row__copy">
              <span class="setting-row__label">界面语言</span>
              <span class="setting-row__description">部分页面仍在持续完善本地化</span>
            </div>
            <select class="native-select" :value="settings.language" @change="onLanguageChange">
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped src="./AppearanceSettings.css"></style>
