<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings';
import type { ThemeMode } from '@shared/domain/instance';

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
          <span v-if="settingsStore.settings.themeMode === opt.value" class="msr segmented__check" aria-hidden="true">check</span>
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
  transition: background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
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
  transition: outline-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.swatch--selected {
  outline-color: var(--md-sys-color-primary);
}

.field {
  position: relative;
  display: block;
  height: 56px;
}

.field__input {
  width: 100%;
  height: 100%;
  padding: 20px 16px 6px;
  border-radius: var(--md-sys-shape-corner-small);
  border: 1px solid var(--md-sys-color-outline);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
  outline: none;
  transition: border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.field__input:focus {
  border: 2px solid var(--md-sys-color-primary);
  padding: 19px 15px 5px;
}

.field__label {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface);
  padding: 0 4px;
  pointer-events: none;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.field__input:focus + .field__label,
.field__input:not(:placeholder-shown) + .field__label {
  top: 0;
  transform: translateY(-50%) scale(0.85);
}

.field__input:focus + .field__label {
  color: var(--md-sys-color-primary);
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
</style>
