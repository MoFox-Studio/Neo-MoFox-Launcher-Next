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

<style scoped>
.appearance-panel {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  color: var(--md-sys-color-on-surface);
}

.appearance-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
  padding: 4px 4px 0;
}

.appearance-panel__header h2,
.appearance-panel__header p,
.appearance-card__heading h3,
.appearance-card__heading p {
  margin: 0;
}

.appearance-panel__header h2 {
  font: var(--md-sys-typescale-headline-small);
}

.appearance-panel__header p,
.appearance-card__heading p {
  margin-top: 4px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.active-theme-chip {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
  min-height: 36px;
  padding: 6px 12px 6px 8px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
}

.active-theme-chip__color {
  width: 22px;
  height: 22px;
  border: 2px solid var(--md-sys-color-surface);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--md-sys-color-outline-variant);
}

.appearance-stack {
  display: grid;
  gap: var(--app-density-section-gap);
}

.appearance-card {
  overflow: hidden;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.appearance-card__heading {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px 22px 14px;
}

.appearance-card__heading > .msr {
  color: var(--md-sys-color-primary);
  font-size: 26px;
}

.appearance-card__heading h3 {
  font: var(--md-sys-typescale-title-large);
}

.segmented-column {
  display: grid;
  gap: 3px;
  padding: 0 10px 10px;
}

.setting-row,
.setting-block,
.wallpaper-block {
  border-radius: 7px;
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 88%, transparent);
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.segmented-column > :first-child {
  border-radius: 18px 18px 7px 7px;
}

.segmented-column > :last-child {
  border-radius: 7px 7px 18px 18px;
}

.segmented-column > :only-child {
  border-radius: 18px;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: var(--app-density-row-min-height);
  padding: var(--app-density-row-padding-block) 18px;
}

.setting-row__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 180px;
}

.setting-row__label {
  font: var(--md-sys-typescale-body-large);
}

.setting-row__description,
.setting-block__hint {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.setting-row__error {
  margin-top: 4px;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-small);
}

.setting-block,
.wallpaper-block {
  padding: 16px 18px 18px;
}

.setting-block__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
  font: var(--md-sys-typescale-body-large);
}

.choice-segment {
  display: flex;
  overflow: hidden;
  flex: 0 0 auto;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-full);
}

.choice-segment__button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: var(--app-density-control-height);
  padding: 0 14px;
  border: 0;
  border-right: 1px solid var(--md-sys-color-outline);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.choice-segment__button:last-child {
  border-right: 0;
}

.choice-segment__button--selected {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.choice-segment__button .msr {
  font-size: 18px;
}

.source-grid,
.density-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.source-option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 70px;
  padding: 10px 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-low);
  color: var(--md-sys-color-on-surface);
  text-align: left;
  cursor: pointer;
}

.source-option--selected,
.density-option--selected,
.motion-option--selected,
.visual-choice__button--selected {
  border-color: var(--md-sys-color-primary);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.source-option:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.source-option__icon {
  color: var(--md-sys-color-primary);
}

.source-option__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.source-option strong,
.source-option small,
.palette-option strong,
.palette-option small,
.motion-option strong,
.motion-option small,
.density-option strong,
.range-row strong,
.range-row small {
  display: block;
}

.source-option strong,
.palette-option strong,
.motion-option strong,
.density-option strong,
.range-row strong {
  font: var(--md-sys-typescale-label-large);
}

.source-option small,
.palette-option small,
.motion-option small,
.range-row small {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.source-option__check {
  color: var(--md-sys-color-primary);
  font-size: 20px;
}

.inline-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 10px 2px 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.inline-note .msr {
  font-size: 17px;
}

.seed-colors {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.seed-color {
  position: relative;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 2px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 70%, transparent);
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  text-shadow: 0 1px 2px #000;
}

.seed-color--selected {
  outline: 3px solid var(--md-sys-color-primary);
  outline-offset: 2px;
}

.seed-color .msr {
  font-size: 18px;
}

.seed-color--custom {
  overflow: hidden;
  border-color: transparent;
  background: conic-gradient(#f44336, #ffeb3b, #4caf50, #00bcd4, #3f51b5, #e91e63, #f44336);
}

.seed-color--custom input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.palette-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.palette-option {
  min-width: 0;
  padding: 9px;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: var(--md-sys-shape-corner-large);
  color: var(--md-sys-color-on-surface);
  text-align: left;
  cursor: pointer;
}

.palette-option--selected {
  border-color: var(--md-sys-color-primary);
  box-shadow: 0 0 0 1px var(--md-sys-color-surface);
}

.palette-option__preview {
  position: relative;
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  height: 40px;
  overflow: hidden;
  border-radius: 10px;
}

.palette-option__preview > span:not(.palette-option__check) {
  display: block;
}

.palette-option__check {
  position: absolute;
  top: 8px;
  left: 12px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 16px;
}

.palette-option__copy {
  display: flex;
  flex-direction: column;
  margin-top: 8px;
  color: inherit;
}

.wallpaper-actions,
.visual-choice {
  display: flex;
  align-items: center;
  gap: 6px;
}

.text-action,
.icon-action {
  border: 0;
  background: transparent;
  color: var(--md-sys-color-primary);
  cursor: pointer;
}

.text-action {
  min-height: 40px;
  padding: 0 14px;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
}

.icon-action {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.icon-action--danger {
  color: var(--md-sys-color-error);
}

.text-action:disabled,
.icon-action:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.wallpaper-preview {
  position: relative;
  height: 220px;
  overflow: hidden;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-low);
}

.wallpaper-preview img,
.wallpaper-preview video {
  position: absolute;
  inset: -16px;
  width: calc(100% + 32px);
  height: calc(100% + 32px);
  object-fit: cover;
  transform: scale(1.03);
}

.wallpaper-preview__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.wallpaper-preview__dim,
.wallpaper-preview__surface {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.wallpaper-preview__dim {
  background: #000;
}

.wallpaper-preview__surface {
  display: grid;
  grid-template-columns: 72px 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 8px;
  margin: 22px;
  background: transparent;
}

.wallpaper-preview__surface span {
  border-radius: 14px;
  background: var(--md-sys-color-surface-container);
}

.wallpaper-preview__surface span:first-child {
  grid-row: 1 / -1;
}

.wallpaper-sliders {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}

.wallpaper-sliders--disabled {
  opacity: 0.48;
}

.range-row {
  display: grid;
  grid-template-columns: 28px 130px minmax(120px, 1fr) 48px;
  align-items: center;
  gap: 10px;
  min-height: 48px;
}

.range-row__icon {
  color: var(--md-sys-color-primary);
  font-size: 20px;
}

.range-row input {
  width: 100%;
  accent-color: var(--md-sys-color-primary);
}

.range-row output {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
  text-align: right;
}

.wallpaper-palette {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.wallpaper-palette > div {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.wallpaper-color {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 2px solid var(--md-sys-color-surface);
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  text-shadow: 0 1px 2px #000;
}

.wallpaper-color--selected {
  outline: 3px solid var(--md-sys-color-primary);
  outline-offset: 1px;
}

.wallpaper-color .msr {
  font-size: 17px;
}

.visual-choice__button,
.density-option,
.motion-option {
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-low);
  color: var(--md-sys-color-on-surface);
  cursor: pointer;
}

.visual-choice__button {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 42px;
  padding: 0 13px;
  border-radius: var(--md-sys-shape-corner-large);
  font: var(--md-sys-typescale-label-large);
}

.visual-choice__button .msr {
  font-size: 20px;
}

.density-option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 56px;
  border-radius: var(--md-sys-shape-corner-large);
}

.motion-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.motion-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 64px;
  padding: 10px 12px;
  border-radius: var(--md-sys-shape-corner-large);
  text-align: left;
}

.motion-option > span:first-child {
  min-width: 0;
}

.motion-option > .msr {
  color: var(--md-sys-color-primary);
  font-size: 20px;
}

.native-select {
  min-width: 150px;
  height: var(--app-density-control-height);
  padding: 0 38px 0 13px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-small);
  outline: none;
  background: var(--md-sys-color-surface-container-low);
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
}

.native-select:focus {
  border: 2px solid var(--md-sys-color-primary);
}

.reveal-enter-active,
.reveal-leave-active {
  overflow: hidden;
  transition:
    opacity var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard),
    transform var(--app-motion-duration-spatial) var(--app-motion-easing-spatial);
}

.reveal-enter-from,
.reveal-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.985);
}

@media (max-width: 840px) {
  .source-grid,
  .palette-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .setting-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .choice-segment,
  .visual-choice {
    width: 100%;
  }

  .choice-segment__button,
  .visual-choice__button {
    flex: 1;
  }
}

@media (max-width: 560px) {
  .appearance-panel__header {
    flex-direction: column;
  }

  .source-grid,
  .palette-grid,
  .density-grid,
  .motion-grid {
    grid-template-columns: 1fr;
  }

  .choice-segment__button .msr {
    display: none;
  }

  .range-row {
    grid-template-columns: 26px 1fr 46px;
  }

  .range-row input {
    grid-column: 2 / -1;
  }
}
</style>
