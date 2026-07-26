<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import { mofoxApi } from '@/services/mofox-api';
import type { SystemEnvInfo } from '@shared/domain/system-env';
import type { ThemeMode } from '@shared/domain/instance';

interface ThemeOption {
  value: ThemeMode;
  label: string;
  icon: string;
}

interface EnvRow {
  icon: string;
  label: string;
  value?: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'system', label: '跟随系统', icon: 'routine' },
  { value: 'light', label: '浅色', icon: 'light_mode' },
  { value: 'dark', label: '深色', icon: 'dark_mode' },
];

const SEED_COLORS = ['#7C5CDB', '#B3261E', '#006A6A', '#9C4400', '#386A20', '#345CA8'];

const router = useRouter();
const settingsStore = useSettingsStore();

const totalSteps = 3;
const currentStep = ref(1);

// ---- Step 2: environment detection ----
const envInfo = ref<SystemEnvInfo | null>(null);
const envLoading = ref(false);

async function loadEnv(): Promise<void> {
  envLoading.value = true;
  try {
    envInfo.value = await mofoxApi.detectSystemEnv();
  } finally {
    envLoading.value = false;
  }
}

const envRows = ref<EnvRow[]>([]);

watch(envInfo, (info) => {
  if (!info) {
    envRows.value = [];
    return;
  }
  envRows.value = [
    { icon: 'dns', label: '操作系统', value: `${info.osType} ${info.osRelease}` },
    { icon: 'memory', label: '架构', value: info.arch },
    { icon: 'computer', label: '主机名', value: info.hostname },
    { icon: 'terminal', label: 'Python', value: info.pythonVersion },
    { icon: 'bolt', label: 'uv', value: info.uvVersion },
    { icon: 'commit', label: 'Git', value: info.gitVersion },
  ];
});

// ---- Step 3: preferences ----
const installDir = ref(settingsStore.settings.defaultInstallDir);

watch(
  () => settingsStore.settings.defaultInstallDir,
  (value) => {
    if (value !== installDir.value) installDir.value = value;
  },
);

function selectTheme(mode: ThemeMode): void {
  void settingsStore.update({ themeMode: mode });
}

function selectSeed(color: string): void {
  void settingsStore.update({ seedColor: color });
}

function onInstallDirBlur(): void {
  void settingsStore.update({ defaultInstallDir: installDir.value });
}

function goToStep2(): void {
  currentStep.value = 2;
  void loadEnv();
}

function goToStep3(): void {
  currentStep.value = 3;
}

function finish(): void {
  void settingsStore.update({ defaultInstallDir: installDir.value });
  router.push({ name: 'dashboard' });
}

onMounted(async () => {
  if (!settingsStore.loaded) {
    await settingsStore.load();
    installDir.value = settingsStore.settings.defaultInstallDir;
  }
});
</script>

<template>
  <div class="oobe">
    <div class="oobe__dots">
      <span
        v-for="step in totalSteps"
        :key="step"
        class="oobe__dot"
        :class="{ 'oobe__dot--active': step <= currentStep }"
      ></span>
    </div>

    <div class="oobe__stage">
      <transition name="oobe-slide" mode="out-in">
        <section v-if="currentStep === 1" key="welcome" class="oobe__step oobe__step--welcome">
          <div class="oobe__hero">
            <span class="msr msr--fill oobe__hero-icon" aria-hidden="true">pets</span>
          </div>
          <h1 class="oobe__title">欢迎使用 Neo-MoFox</h1>
          <p class="oobe__intro">
            Neo-MoFox Launcher 帮助你快速安装、配置与管理机器人实例。 接下来的几步将检测运行环境并设置基础偏好，整个过程只需一分钟。
          </p>
          <button type="button" class="btn btn--filled btn--large state-layer" @click="goToStep2">
            开始
          </button>
        </section>

        <section v-else-if="currentStep === 2" key="env" class="oobe__step">
          <h2 class="oobe__step-title">环境检测</h2>
          <p class="oobe__step-desc">正在检查运行所需的系统环境</p>

          <div v-if="envLoading" class="oobe__loading">
            <span class="spinner" aria-hidden="true"></span>
            <span>检测中…</span>
          </div>
          <ul v-else class="env-list">
            <li v-for="row in envRows" :key="row.label" class="env-list__item">
              <span class="msr env-list__icon" aria-hidden="true">{{ row.icon }}</span>
              <span class="env-list__label">{{ row.label }}</span>
              <span v-if="row.value" class="env-list__value">
                <span class="msr msr--fill env-list__status env-list__status--ok" aria-hidden="true"
                  >check_circle</span
                >
                {{ row.value }}
              </span>
              <span v-else class="env-list__value env-list__value--missing">
                <span class="msr env-list__status env-list__status--error" aria-hidden="true"
                  >error</span
                >
                未检测到
              </span>
            </li>
          </ul>

          <button
            type="button"
            class="btn btn--filled state-layer"
            :disabled="envLoading"
            @click="goToStep3"
          >
            继续
          </button>
        </section>

        <section v-else key="prefs" class="oobe__step">
          <h2 class="oobe__step-title">偏好设置</h2>

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
          </div>

          <button type="button" class="btn btn--filled btn--large state-layer" @click="finish">
            完成
          </button>
        </section>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.oobe {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--md-sys-color-surface);
  padding: 40px 24px;
  overflow-y: auto;
}

.oobe__dots {
  display: flex;
  gap: 8px;
  margin-bottom: 48px;
}

.oobe__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  transition: background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.oobe__dot--active {
  background: var(--md-sys-color-primary);
}

.oobe__stage {
  width: 100%;
  max-width: 560px;
  flex: 1;
  display: flex;
  align-items: center;
}

.oobe__step {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.oobe__step--welcome {
  align-items: center;
  text-align: center;
  gap: 8px;
}

.oobe__hero {
  width: 160px;
  height: 160px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary-container);
  display: grid;
  place-items: center;
  margin-bottom: 32px;
}

.oobe__hero-icon {
  font-size: 120px;
  color: var(--md-sys-color-primary);
}

.oobe__title {
  font: var(--md-sys-typescale-display-small);
  margin: 0 0 16px;
}

.oobe__intro {
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
  max-width: 440px;
  margin: 0 0 40px;
}

.oobe__step-title {
  font: var(--md-sys-typescale-headline-small);
  margin: 0 0 4px;
}

.oobe__step-desc {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 24px;
}

.oobe__loading {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
  margin-bottom: 24px;
}

/* ---- Environment list ---- */
.env-list {
  list-style: none;
  margin: 0 0 32px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.env-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.env-list__icon {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 20px;
}

.env-list__label {
  flex: 1;
  font: var(--md-sys-typescale-body-large);
}

.env-list__value {
  display: flex;
  align-items: center;
  gap: 6px;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.env-list__value--missing {
  color: var(--md-sys-color-error);
}

.env-list__status {
  font-size: 18px;
}

.env-list__status--ok {
  color: var(--md-sys-color-tertiary);
}

.env-list__status--error {
  color: var(--md-sys-color-error);
}

/* ---- Preferences ---- */
.pref-block {
  margin-bottom: 32px;
}

.pref-block__label {
  display: block;
  font: var(--md-sys-typescale-title-small);
  margin-bottom: 12px;
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

/* ---- Outlined text field (self-drawn, shared pattern) ---- */
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

/* ---- Buttons (MD3 self-drawn) ---- */
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

.btn--large {
  height: 56px;
  padding: 0 32px;
  font: var(--md-sys-typescale-title-medium);
}

/* ---- Indeterminate circular spinner ---- */
.spinner {
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-primary);
  animation: spinner-spin 0.8s linear infinite;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ---- Step transition ---- */
.oobe-slide-enter-active,
.oobe-slide-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized);
}

.oobe-slide-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.oobe-slide-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
</style>
