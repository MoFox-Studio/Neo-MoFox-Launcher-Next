<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '@/stores/settings';
import type { LauncherSettings } from '@shared/domain/instance';

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const update = (patch: Partial<LauncherSettings>) => {
  settingsStore.update(patch);
};

const presetColors = ['#7C5CDB', '#B3261E', '#006A6A', '#9C4400', '#386A20', '#345CA8'];

const isPresetColor = (color: string) => presetColors.includes(color.toUpperCase());

const handleNumberInput = (key: keyof LauncherSettings, event: Event, min: number, max: number) => {
  const input = event.target as HTMLInputElement;
  let val = parseInt(input.value);
  if (isNaN(val)) return;
  if (val < min) val = min;
  if (val > max) val = max;
  update({ [key]: val });
};
</script>

<template>
  <div class="settings-view">
    <header class="settings-view__header">
      <h1 class="settings-view__title">设置</h1>
    </header>

    <div class="settings-view__content">
      <!-- 外观 -->
      <section class="settings-group">
        <h2 class="settings-group__title">外观</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">routine</span>
            <div class="settings-item__body">
              <span class="settings-item__label">主题模式</span>
            </div>
            <div class="segmented-button">
              <button
                class="segmented-button__item state-layer"
                :class="{ 'segmented-button__item--selected': settings.themeMode === 'system' }"
                @click="update({ themeMode: 'system' })"
                role="radio"
                :aria-checked="settings.themeMode === 'system'"
              >
                <span v-if="settings.themeMode === 'system'" class="msr segmented-button__check">check</span>
                <span>跟随系统</span>
              </button>
              <button
                class="segmented-button__item state-layer"
                :class="{ 'segmented-button__item--selected': settings.themeMode === 'light' }"
                @click="update({ themeMode: 'light' })"
                role="radio"
                :aria-checked="settings.themeMode === 'light'"
              >
                <span v-if="settings.themeMode === 'light'" class="msr segmented-button__check">check</span>
                <span>浅色</span>
              </button>
              <button
                class="segmented-button__item state-layer"
                :class="{ 'segmented-button__item--selected': settings.themeMode === 'dark' }"
                @click="update({ themeMode: 'dark' })"
                role="radio"
                :aria-checked="settings.themeMode === 'dark'"
              >
                <span v-if="settings.themeMode === 'dark'" class="msr segmented-button__check">check</span>
                <span>深色</span>
              </button>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">palette</span>
            <div class="settings-item__body">
              <span class="settings-item__label">主题色</span>
            </div>
            <div class="color-palette">
              <button
                v-for="color in presetColors"
                :key="color"
                class="color-dot state-layer"
                :class="{ 'color-dot--selected': settings.seedColor.toUpperCase() === color }"
                :style="{ backgroundColor: color }"
                @click="update({ seedColor: color })"
              ></button>
              <div
                class="color-dot color-dot--custom"
                :class="{ 'color-dot--selected': !isPresetColor(settings.seedColor) }"
              >
                <input
                  type="color"
                  class="color-dot__input"
                  :value="settings.seedColor"
                  @input="(e) => update({ seedColor: (e.target as HTMLInputElement).value })"
                />
              </div>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">language</span>
            <div class="settings-item__body">
              <span class="settings-item__label">语言</span>
            </div>
            <div class="select-wrapper">
              <select
                class="native-select"
                :value="settings.language"
                @change="(e) => update({ language: (e.target as HTMLSelectElement).value as any })"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
              <span class="msr select-wrapper__arrow">arrow_drop_down</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 通用 -->
      <section class="settings-group">
        <h2 class="settings-group__title">通用</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">folder</span>
            <div class="settings-item__body">
              <span class="settings-item__label">默认安装目录</span>
              <span class="settings-item__desc settings-item__desc--mono">{{ settings.defaultInstallDir }}</span>
            </div>
            <button class="text-button state-layer">更改</button>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">pip</span>
            <div class="settings-item__body">
              <span class="settings-item__label">关闭时最小化到托盘</span>
            </div>
            <div
              class="md-switch"
              role="switch"
              :aria-checked="settings.closeToTray"
              :class="{ 'md-switch--checked': settings.closeToTray }"
              @click="update({ closeToTray: !settings.closeToTray })"
            >
              <div class="md-switch__thumb"></div>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">speed</span>
            <div class="settings-item__body">
              <span class="settings-item__label">硬件加速</span>
              <span class="settings-item__desc">更改后需重启启动器生效</span>
            </div>
            <div
              class="md-switch"
              role="switch"
              :aria-checked="settings.hardwareAcceleration"
              :class="{ 'md-switch--checked': settings.hardwareAcceleration }"
              @click="update({ hardwareAcceleration: !settings.hardwareAcceleration })"
            >
              <div class="md-switch__thumb"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 网络 -->
      <section class="settings-group">
        <h2 class="settings-group__title">网络</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">swap_driving_apps_wheel</span>
            <div class="settings-item__body">
              <span class="settings-item__label">自动选择最快镜像</span>
            </div>
            <div
              class="md-switch"
              role="switch"
              :aria-checked="settings.mirrorAutoSelect"
              :class="{ 'md-switch--checked': settings.mirrorAutoSelect }"
              @click="update({ mirrorAutoSelect: !settings.mirrorAutoSelect })"
            >
              <div class="md-switch__thumb"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 日志 -->
      <section class="settings-group">
        <h2 class="settings-group__title">日志</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">hard_drive</span>
            <div class="settings-item__body">
              <span class="settings-item__label">单文件上限</span>
            </div>
            <div class="input-field">
              <input
                type="number"
                class="input-field__native"
                :value="settings.maxLogFileSizeMb"
                @change="(e) => handleNumberInput('maxLogFileSizeMb', e, 1, 512)"
              />
              <span class="input-field__suffix">MB</span>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">history</span>
            <div class="settings-item__body">
              <span class="settings-item__label">归档保留天数</span>
            </div>
            <div class="input-field">
              <input
                type="number"
                class="input-field__native"
                :value="settings.maxLogArchiveDays"
                @change="(e) => handleNumberInput('maxLogArchiveDays', e, 1, 90)"
              />
              <span class="input-field__suffix">天</span>
            </div>
          </div>

          <div class="settings-divider"></div>

          <div class="settings-item">
            <span class="msr settings-item__icon">folder_zip</span>
            <div class="settings-item__body">
              <span class="settings-item__label">压缩归档日志</span>
            </div>
            <div
              class="md-switch"
              role="switch"
              :aria-checked="settings.compressLogArchive"
              :class="{ 'md-switch--checked': settings.compressLogArchive }"
              @click="update({ compressLogArchive: !settings.compressLogArchive })"
            >
              <div class="md-switch__thumb"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- 关于 -->
      <section class="settings-group">
        <h2 class="settings-group__title">关于</h2>
        <div class="settings-group__card">
          <div class="settings-item">
            <span class="msr settings-item__icon">info</span>
            <div class="settings-item__body">
              <span class="settings-item__label">Neo-MoFox Launcher</span>
              <span class="settings-item__desc">版本 0.1.0</span>
            </div>
            <button class="text-button state-layer">检查更新</button>
          </div>
          <div class="settings-divider"></div>
          <div class="settings-item">
            <span class="msr settings-item__icon">description</span>
            <div class="settings-item__body">
              <span class="settings-item__desc">基于 Electron · Vue 3 · Material Design 3</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  height: 100%;
  overflow-y: auto;
  background: var(--md-sys-color-surface);
}

.settings-view__header {
  padding: 24px 32px;
}

.settings-view__title {
  margin: 0;
  font: var(--md-sys-typescale-headline-small);
  color: var(--md-sys-color-on-surface);
}

.settings-view__content {
  max-width: 760px;
  margin: 0 auto 0 0;
  padding: 0 32px 64px;
}

.settings-group__title {
  margin: 32px 0 12px;
  font: var(--md-sys-typescale-title-small);
  color: var(--md-sys-color-primary);
}

.settings-group__card {
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
}

.settings-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 16px;
  min-height: 56px;
}

.settings-item__icon {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 24px;
}

.settings-item__body {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.settings-item__label {
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface);
}

.settings-item__desc {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.settings-item__desc--mono {
  font-family: var(--md-ref-typeface-mono);
}

.settings-divider {
  height: 1px;
  background: var(--md-sys-color-outline-variant);
  margin: 0 16px;
}

/* Segmented Button */
.segmented-button {
  display: flex;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-full);
  overflow: hidden;
}

.segmented-button__item {
  height: 40px;
  padding: 0 16px;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  border-right: 1px solid var(--md-sys-color-outline);
  position: relative;
}

.segmented-button__item:last-child {
  border-right: none;
}

.segmented-button__item--selected {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.segmented-button__check {
  font-size: 18px;
}

/* Color Palette */
.color-palette {
  display: flex;
  gap: 12px;
}

.color-dot {
  width: 24px;
  height: 24px;
  border-radius: var(--md-sys-shape-corner-full);
  border: none;
  cursor: pointer;
  position: relative;
}

.color-dot--selected {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 3px;
}

.color-dot--custom {
  background: conic-gradient(from 0deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000);
}

.color-dot__input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

/* Select */
.select-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-small);
  padding: 0 12px;
  min-width: 120px;
}

.native-select {
  appearance: none;
  background: transparent;
  border: none;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  width: 100%;
  height: 40px;
  padding-right: 24px;
  outline: none;
  cursor: pointer;
}

.select-wrapper__arrow {
  position: absolute;
  right: 8px;
  pointer-events: none;
  color: var(--md-sys-color-on-surface-variant);
}

/* Text Button */
.text-button {
  background: transparent;
  border: none;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
  padding: 10px 12px;
  border-radius: var(--md-sys-shape-corner-full);
  cursor: pointer;
  position: relative;
}

/* MD3 Switch */
.md-switch {
  width: 52px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  border: 2px solid var(--md-sys-color-outline);
  position: relative;
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch__thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-on-surface-variant);
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch--checked {
  background: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.md-switch--checked .md-switch__thumb {
  left: 20px;
  width: 24px;
  height: 24px;
  background: var(--md-sys-color-on-primary);
}

/* Input Field */
.input-field {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-extra-small);
  padding: 0 12px;
  height: 40px;
  min-width: 100px;
}

.input-field:focus-within {
  border: 2px solid var(--md-sys-color-primary);
  padding: 0 11px;
}

.input-field__native {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  outline: none;
  text-align: right;
}

.input-field__native::-webkit-inner-spin-button,
.input-field__native::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}

.input-field__suffix {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
}
</style>
