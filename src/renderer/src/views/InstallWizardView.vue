<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import { useInstallStore } from '@/stores/install';
import { mofoxApi } from '@/services/mofox-api';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import type { MirrorSource } from '@shared/domain/mirror';
import type { InstallRequest, InstallStepId } from '@shared/domain/instance';

// 六步安装向导：收集请求参数，并持续呈现安装仓库中的后台进度。
const STEP_TITLES = ['选择平台', '实例信息', '安装位置', '镜像源', '确认摘要', '执行安装'];

const PLATFORM_LABELS: Record<string, string> = {
  win32: 'Windows',
  linux: 'Linux',
  darwin: 'macOS',
};

const STEP_LABELS: Record<InstallStepId, string> = {
  prepare: '准备',
  download: '下载',
  extract: '解压',
  dependencies: '依赖',
  configure: '配置',
  finalize: '完成',
};

const router = useRouter();
const settingsStore = useSettingsStore();
const installStore = useInstallStore();

// 当前步骤与各步骤的局部输入共同控制校验和页面跳转。
const currentStep = ref(1);

// ---- Step 1: platform ----
const platforms = ref<BotPlatformMetadata[]>([]);
const platformsLoading = ref(false);
const selectedPlatformId = ref<string | null>(null);

const selectedPlatform = computed<BotPlatformMetadata | null>(
  () => platforms.value.find((p) => p.id === selectedPlatformId.value) ?? null,
);

function platformLabel(sys: string): string {
  return PLATFORM_LABELS[sys] ?? sys;
}

// ---- Step 2: instance info ----
const instanceName = ref('');
const nameTouched = ref(false);
const versionChoice = ref<'latest' | 'custom'>('latest');
const customVersion = ref('');

const nameError = computed(() => {
  const trimmed = instanceName.value.trim();
  if (!trimmed) return '实例名称不能为空';
  if (trimmed.length > 32) return '实例名称不能超过 32 个字符';
  return '';
});

const resolvedVersion = computed(() =>
  versionChoice.value === 'custom'
    ? customVersion.value.trim()
    : (selectedPlatform.value?.latestVersion ?? ''),
);

function onNameInput(): void {
  nameTouched.value = true;
}

watch(selectedPlatformId, () => {
  versionChoice.value = 'latest';
  customVersion.value = '';
});

// ---- Step 3: install location ----
const targetDir = ref('');
const targetDirTouched = ref(false);

watch(
  [instanceName, () => settingsStore.settings.defaultInstallDir],
  () => {
    if (targetDirTouched.value) return;
    const base = settingsStore.settings.defaultInstallDir;
    const name = instanceName.value.trim();
    if (!base || !name) return;
    const sep = base.endsWith('\\') || base.endsWith('/') ? '' : '\\';
    targetDir.value = `${base}${sep}${name}`;
  },
  { immediate: true },
);

function onTargetDirInput(): void {
  targetDirTouched.value = true;
}

// ---- Step 4: mirrors ----
// 镜像列表、选择结果和测速态构成第四步的响应式状态。
const mirrors = ref<MirrorSource[]>([]);
const selectedMirrorId = ref<string | null>(null);
const remeasuring = ref(false);

const mirrorAutoSelect = computed({
  get: () => settingsStore.settings.mirrorAutoSelect,
  set: (value: boolean) => {
    void settingsStore.update({ mirrorAutoSelect: value });
  },
});

async function loadMirrors(): Promise<void> {
  mirrors.value = await mofoxApi.listMirrors();
}

async function remeasure(): Promise<void> {
  // 测速完成后重新拉取列表，并选中 API 给出的最佳镜像。
  remeasuring.value = true;
  try {
    const best = await mofoxApi.selectBestMirror();
    await loadMirrors();
    selectedMirrorId.value = best.mirror.id;
  } finally {
    remeasuring.value = false;
  }
}

function latencyClass(ms?: number): string {
  if (ms === undefined) return '';
  return ms < 100 ? 'mirror-item__latency--fast' : 'mirror-item__latency--normal';
}

// ---- Step validation & navigation ----
// 每一步独立校验，导航只能前进到已满足条件的下一步。
const stepValid = computed<Record<number, boolean>>(() => ({
  1: selectedPlatformId.value !== null,
  2: nameError.value === '' && resolvedVersion.value !== '',
  3: targetDir.value.trim() !== '',
  4: mirrorAutoSelect.value || selectedMirrorId.value !== null,
  5: true,
  6: true,
}));

const canGoNext = computed(() => stepValid.value[currentStep.value] ?? false);

function goNext(): void {
  if (!canGoNext.value || currentStep.value >= 5) return;
  currentStep.value += 1;
}

function goPrev(): void {
  if (currentStep.value > 1) currentStep.value -= 1;
}

function goToStep(step: number): void {
  if (step < currentStep.value && currentStep.value < 6) currentStep.value = step;
}

// ---- Step 5/6: confirm & execute ----
const progress = computed(() => installStore.progress);
const progressPercent = computed(() => {
  const p = progress.value;
  if (!p || p.progress < 0) return 0;
  return Math.round(p.progress * 100);
});
const isIndeterminate = computed(() => !progress.value || progress.value.progress < 0);

const logPanelOpen = ref(true);
const logPanelRef = ref<HTMLDivElement | null>(null);

watch(
  () => installStore.logLines.length,
  async () => {
    await nextTick();
    const el = logPanelRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

async function startInstall(): Promise<void> {
  // 从已确认字段构造不可变安装请求，再切换到后台执行步骤。
  const request: InstallRequest = {
    instanceName: instanceName.value.trim(),
    platformId: selectedPlatformId.value ?? '',
    version: resolvedVersion.value,
    targetDir: targetDir.value.trim(),
    mirrorId: mirrorAutoSelect.value ? undefined : (selectedMirrorId.value ?? undefined),
  };
  currentStep.value = 6;
  await installStore.begin(request);
}

async function retryInstall(): Promise<void> {
  await installStore.retry();
}

async function cancelInstall(): Promise<void> {
  await installStore.cancel();
}

function goToInstances(): void {
  router.push({ name: 'instances' });
}

onMounted(async () => {
  // 恢复后台安装时直接回到执行页，并异步加载平台和镜像数据。
  if (installStore.isInstalling) {
    currentStep.value = 6;
  }
  platformsLoading.value = true;
  try {
    platforms.value = await mofoxApi.listBotPlatforms();
  } finally {
    platformsLoading.value = false;
  }
  await loadMirrors();
});
</script>

<template>
  <div class="wizard">
    <!-- 左侧步骤导航与右侧动态内容面板 -->
    <aside class="wizard__rail">
      <ol class="stepper">
        <li
          v-for="(title, idx) in STEP_TITLES"
          :key="title"
          class="stepper__item"
          :class="{
            'stepper__item--done': idx + 1 < currentStep,
            'stepper__item--current': idx + 1 === currentStep,
          }"
        >
          <button
            type="button"
            class="stepper__marker state-layer"
            :disabled="idx + 1 >= currentStep"
            @click="goToStep(idx + 1)"
          >
            <span v-if="idx + 1 < currentStep" class="msr msr--fill" aria-hidden="true">check</span>
            <span v-else>{{ idx + 1 }}</span>
          </button>
          <span class="stepper__title">{{ title }}</span>
          <span v-if="idx < STEP_TITLES.length - 1" class="stepper__line"></span>
        </li>
      </ol>
    </aside>

    <div class="wizard__panel">
      <transition name="wizard-slide" mode="out-in">
        <div :key="currentStep" class="wizard__content">
          <!-- 平台、实例信息、目录和镜像配置步骤 -->
          <section v-if="currentStep === 1" class="step">
            <h2 class="step__title">选择平台</h2>
            <p class="step__desc">选择要安装的机器人平台</p>

            <div v-if="platformsLoading" class="step__loading">
              <span class="spinner" aria-hidden="true"></span>
              <span>加载平台列表…</span>
            </div>
            <div v-else class="platform-grid">
              <button
                v-for="p in platforms"
                :key="p.id"
                type="button"
                class="platform-card state-layer"
                :class="{ 'platform-card--selected': selectedPlatformId === p.id }"
                @click="selectedPlatformId = p.id"
              >
                <span
                  v-if="selectedPlatformId === p.id"
                  class="msr msr--fill platform-card__check"
                  aria-hidden="true"
                  >check_circle</span
                >
                <h3 class="platform-card__name">{{ p.name }}</h3>
                <p class="platform-card__desc">{{ p.description }}</p>
                <div class="platform-card__chips">
                  <span v-for="sys in p.supportedPlatforms" :key="sys" class="chip">{{
                    platformLabel(sys)
                  }}</span>
                </div>
                <div v-if="p.latestVersion" class="platform-card__version">
                  最新版本 {{ p.latestVersion }}
                </div>
              </button>
            </div>
          </section>

          <section v-else-if="currentStep === 2" class="step">
            <h2 class="step__title">实例信息</h2>

            <label class="field" :class="{ 'field--error': nameTouched && nameError }">
              <input
                v-model="instanceName"
                class="field__input"
                type="text"
                placeholder=" "
                maxlength="32"
                @input="onNameInput"
              />
              <span class="field__label">实例名称</span>
            </label>
            <p v-if="nameTouched && nameError" class="field__support field__support--error">
              {{ nameError }}
            </p>

            <label class="field field--select">
              <select v-model="versionChoice" class="field__input field__input--select">
                <option value="latest" :disabled="!selectedPlatform?.latestVersion">
                  {{
                    selectedPlatform?.latestVersion
                      ? `最新版本 ${selectedPlatform.latestVersion}`
                      : '暂无最新版本'
                  }}
                </option>
                <option value="custom">自定义</option>
              </select>
              <span class="field__label">版本</span>
              <span class="msr field__select-icon" aria-hidden="true">arrow_drop_down</span>
            </label>

            <label v-if="versionChoice === 'custom'" class="field">
              <input v-model="customVersion" class="field__input" type="text" placeholder=" " />
              <span class="field__label">自定义版本号</span>
            </label>
          </section>

          <section v-else-if="currentStep === 3" class="step">
            <h2 class="step__title">安装位置</h2>

            <div class="dir-row">
              <label class="field field--grow">
                <input
                  v-model="targetDir"
                  class="field__input"
                  type="text"
                  placeholder=" "
                  @input="onTargetDirInput"
                />
                <span class="field__label">目标目录</span>
              </label>
              <button type="button" class="btn btn--tonal state-layer">
                <span class="msr" aria-hidden="true">folder_open</span>
                浏览
              </button>
            </div>

            <div class="info-banner">
              <span class="msr info-banner__icon" aria-hidden="true">info</span>
              <span>安装先在临时目录完成，成功后原子移动到该目录。</span>
            </div>
          </section>

          <section v-else-if="currentStep === 4" class="step">
            <h2 class="step__title">镜像源</h2>

            <div class="switch-row">
              <span class="switch-row__label">自动选择最快镜像</span>
              <button
                type="button"
                class="switch"
                role="switch"
                :aria-checked="mirrorAutoSelect"
                :class="{ 'switch--on': mirrorAutoSelect }"
                @click="mirrorAutoSelect = !mirrorAutoSelect"
              >
                <span class="switch__thumb"></span>
              </button>
            </div>

            <template v-if="!mirrorAutoSelect">
              <div class="mirror-toolbar">
                <button
                  type="button"
                  class="btn btn--text state-layer"
                  :disabled="remeasuring"
                  @click="remeasure"
                >
                  <span
                    v-if="remeasuring"
                    class="spinner spinner--small"
                    aria-hidden="true"
                  ></span>
                  <span v-else class="msr" aria-hidden="true">speed</span>
                  重新测速
                </button>
              </div>

              <ul class="mirror-list">
                <li v-for="m in mirrors" :key="m.id">
                  <button
                    type="button"
                    class="mirror-item state-layer"
                    :class="{ 'mirror-item--selected': selectedMirrorId === m.id }"
                    @click="selectedMirrorId = m.id"
                  >
                    <span
                      class="mirror-item__radio"
                      :class="{ 'mirror-item__radio--checked': selectedMirrorId === m.id }"
                    ></span>
                    <span class="mirror-item__body">
                      <span class="mirror-item__name">{{ m.name }}</span>
                      <span class="mirror-item__url">{{ m.baseUrl }}</span>
                    </span>
                    <span
                      v-if="m.latencyMs !== undefined"
                      class="mirror-item__latency"
                      :class="latencyClass(m.latencyMs)"
                      >{{ m.latencyMs }} ms</span
                    >
                  </button>
                </li>
              </ul>
            </template>
          </section>

          <!-- 安装请求确认摘要 -->
          <section v-else-if="currentStep === 5" class="step">
            <h2 class="step__title">确认摘要</h2>

            <dl class="summary">
              <div class="summary__row">
                <dt>平台</dt>
                <dd>{{ selectedPlatform?.name ?? '-' }}</dd>
              </div>
              <div class="summary__row">
                <dt>实例名称</dt>
                <dd>{{ instanceName || '-' }}</dd>
              </div>
              <div class="summary__row">
                <dt>版本</dt>
                <dd>{{ resolvedVersion || '-' }}</dd>
              </div>
              <div class="summary__row">
                <dt>安装目录</dt>
                <dd>{{ targetDir || '-' }}</dd>
              </div>
              <div class="summary__row">
                <dt>镜像源</dt>
                <dd>
                  {{
                    mirrorAutoSelect
                      ? '自动选择最快镜像'
                      : (mirrors.find((m) => m.id === selectedMirrorId)?.name ?? '-')
                  }}
                </dd>
              </div>
            </dl>

            <button type="button" class="btn btn--filled btn--large state-layer" @click="startInstall">
              <span class="msr" aria-hidden="true">rocket_launch</span>
              开始安装
            </button>
          </section>

          <!-- 后台安装进度、日志和结果操作 -->
          <section v-else class="step step--execute">
            <h2 class="step__title">正在安装{{ instanceName ? ` ${instanceName}` : '' }}</h2>
            <p class="step__step-label">
              第 {{ (progress?.stepIndex ?? 0) + 1 }} / {{ progress?.stepCount ?? 6 }} 步 ·
              {{ progress ? STEP_LABELS[progress.step] : '准备' }}
            </p>

            <div class="progress-track">
              <div
                class="progress-track__bar"
                :class="{ 'progress-track__bar--indeterminate': isIndeterminate }"
                :style="isIndeterminate ? undefined : { width: `${progressPercent}%` }"
              ></div>
            </div>

            <div class="log-panel">
              <button
                type="button"
                class="log-panel__toggle state-layer"
                @click="logPanelOpen = !logPanelOpen"
              >
                <span class="msr" aria-hidden="true">{{
                  logPanelOpen ? 'expand_less' : 'expand_more'
                }}</span>
                安装日志
              </button>
              <div v-show="logPanelOpen" ref="logPanelRef" class="log-panel__body">
                <p v-for="(line, idx) in installStore.logLines" :key="idx" class="log-panel__line">
                  {{ line }}
                </p>
              </div>
            </div>

            <div class="execute-actions">
              <template v-if="installStore.isFailed">
                <button type="button" class="btn btn--text state-layer" @click="cancelInstall">
                  取消
                </button>
                <button type="button" class="btn btn--filled state-layer" @click="retryInstall">
                  重试
                </button>
              </template>
              <template v-else-if="installStore.isDone">
                <span class="msr msr--fill execute-actions__done-icon" aria-hidden="true"
                  >check_circle</span
                >
                <button type="button" class="btn btn--filled state-layer" @click="goToInstances">
                  查看实例
                </button>
              </template>
              <template v-else>
                <button type="button" class="btn btn--text state-layer" @click="cancelInstall">
                  取消安装
                </button>
              </template>
            </div>
          </section>
        </div>
      </transition>

      <!-- 非执行步骤的前进与回退控制 -->
      <div v-if="currentStep < 6" class="wizard__nav">
        <button v-if="currentStep > 1" type="button" class="btn btn--text state-layer" @click="goPrev">
          上一步
        </button>
        <div class="wizard__nav-spacer"></div>
        <button
          v-if="currentStep < 5"
          type="button"
          class="btn btn--filled state-layer"
          :disabled="!canGoNext"
          @click="goNext"
        >
          下一步
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard {
  display: flex;
  height: 100%;
  min-height: 0;
}

/* 左侧纵向步骤导航 */
.wizard__rail {
  width: 260px;
  flex: 0 0 260px;
  padding: 40px 24px;
  background: var(--md-sys-color-surface-container-low);
  overflow-y: auto;
}

.stepper {
  list-style: none;
  margin: 0;
  padding: 0;
}

.stepper__item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-bottom: 32px;
}

.stepper__item:last-child {
  padding-bottom: 0;
}

.stepper__marker {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: grid;
  place-items: center;
  font: var(--md-sys-typescale-label-large);
  cursor: default;
  z-index: 1;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.stepper__marker .msr {
  font-size: 18px;
}

.stepper__item--current .stepper__marker {
  border: 2px solid var(--md-sys-color-primary);
  color: var(--md-sys-color-primary);
}

.stepper__item--done .stepper__marker {
  border-color: transparent;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  cursor: pointer;
}

.stepper__title {
  font: var(--md-sys-typescale-title-small);
  color: var(--md-sys-color-on-surface-variant);
  padding-top: 6px;
}

.stepper__item--current .stepper__title {
  color: var(--md-sys-color-on-surface);
}

.stepper__line {
  position: absolute;
  left: 15px;
  top: 32px;
  bottom: 0;
  width: 2px;
  background: var(--md-sys-color-outline-variant);
}

.stepper__item--done .stepper__line {
  background: var(--md-sys-color-primary);
}

/* 右侧内容面板与通用步骤文本 */
.wizard__panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 40px 48px;
  overflow: hidden;
}

.wizard__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  max-width: 560px;
}

.step__title {
  font: var(--md-sys-typescale-headline-small);
  margin: 0 0 4px;
}

.step__desc {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 24px;
}

.step__loading {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

/* 平台选择卡片 */
.platform-grid {
  display: grid;
  gap: 16px;
}

.platform-card {
  position: relative;
  text-align: left;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-low);
  color: var(--md-sys-color-on-surface);
  padding: 20px;
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.platform-card--selected {
  background: var(--md-sys-color-secondary-container);
  border-color: var(--md-sys-color-primary);
}

.platform-card__check {
  position: absolute;
  top: 16px;
  right: 16px;
  color: var(--md-sys-color-primary);
}

.platform-card__name {
  font: var(--md-sys-typescale-title-medium);
  margin: 0 0 4px;
}

.platform-card__desc {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 12px;
}

.platform-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.chip {
  font: var(--md-sys-typescale-label-medium);
  padding: 4px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}

.platform-card__version {
  font: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

/* 浮动标签输入框与校验提示 */
.field {
  position: relative;
  display: block;
  height: 56px;
  margin-bottom: 20px;
}

.field--grow {
  flex: 1;
  margin-bottom: 0;
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

.field__input--select {
  appearance: none;
  cursor: pointer;
  padding-right: 40px;
}

.field__select-icon {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--md-sys-color-on-surface-variant);
  pointer-events: none;
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
.field__input:not(:placeholder-shown) + .field__label,
.field--select .field__label {
  top: 0;
  transform: translateY(-50%) scale(0.85);
}

.field__input:focus + .field__label {
  color: var(--md-sys-color-primary);
}

.field--error .field__input {
  border-color: var(--md-sys-color-error);
}

.field--error .field__label {
  color: var(--md-sys-color-error);
}

.field__support {
  margin: -14px 0 20px 16px;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.field__support--error {
  color: var(--md-sys-color-error);
}

/* 安装目录与说明横幅 */
.dir-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.info-banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.info-banner__icon {
  color: var(--md-sys-color-primary);
  font-size: 20px;
}

/* 自动镜像选择开关 */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 24px;
}

.switch-row__label {
  font: var(--md-sys-typescale-body-large);
}

.switch {
  flex: none;
  width: 52px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid var(--md-sys-color-outline);
  background: var(--md-sys-color-surface-container-highest);
  position: relative;
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.switch__thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  width: 16px;
  height: 16px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-outline);
  transform: translate(0, -50%);
  transition:
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized),
    width var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized),
    height var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.switch--on {
  background: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.switch--on .switch__thumb {
  width: 24px;
  height: 24px;
  background: var(--md-sys-color-on-primary);
  transform: translate(20px, -50%);
}

/* 镜像测速、选择与延迟标签 */
.mirror-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.mirror-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mirror-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  border: 1px solid var(--md-sys-color-outline-variant);
  background: var(--md-sys-color-surface-container-low);
  color: var(--md-sys-color-on-surface);
  cursor: pointer;
  text-align: left;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.mirror-item--selected {
  background: var(--md-sys-color-secondary-container);
  border-color: var(--md-sys-color-primary);
}

.mirror-item__radio {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid var(--md-sys-color-outline);
  position: relative;
}

.mirror-item__radio--checked {
  border-color: var(--md-sys-color-primary);
}

.mirror-item__radio--checked::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
}

.mirror-item__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mirror-item__name {
  font: var(--md-sys-typescale-title-small);
}

.mirror-item__url {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mirror-item__latency {
  flex: none;
  font: var(--md-sys-typescale-label-medium);
  padding: 2px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  color: var(--md-sys-color-on-surface-variant);
  background: color-mix(in srgb, var(--md-sys-color-on-surface-variant) 12%, transparent);
}

.mirror-item__latency--fast {
  color: var(--md-sys-color-tertiary);
  background: color-mix(in srgb, var(--md-sys-color-tertiary) 16%, transparent);
}

/* 安装请求确认摘要 */
.summary {
  margin: 0 0 32px;
}

.summary__row {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 0;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.summary__row dt {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.summary__row dd {
  margin: 0;
  font: var(--md-sys-typescale-title-small);
  text-align: right;
}

/* 执行进度、实时日志和结果操作 */
.step--execute .step__title {
  margin-bottom: 4px;
}

.step__step-label {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 20px;
}

.progress-track {
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  overflow: hidden;
  position: relative;
  margin-bottom: 24px;
}

.progress-track__bar {
  height: 100%;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  transition: width var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

.progress-track__bar--indeterminate {
  width: 40% !important;
  position: absolute;
  animation: progress-indeterminate 1.4s var(--md-sys-motion-easing-standard) infinite;
}

@keyframes progress-indeterminate {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}

.log-panel {
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  overflow: hidden;
  margin-bottom: 24px;
}

.log-panel__toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border: none;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.log-panel__body {
  max-height: 240px;
  overflow-y: auto;
  background: var(--md-sys-color-surface-container-highest);
  padding: 12px 16px;
}

.log-panel__line {
  margin: 0 0 4px;
  font-family: var(--md-ref-typeface-mono);
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--md-sys-color-on-surface-variant);
}

.execute-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.execute-actions__done-icon {
  color: var(--md-sys-color-tertiary);
  font-size: 28px;
}

/* 向导操作按钮与加载指示器 */
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

.btn--tonal {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
  padding: 0 12px;
}

.btn--large {
  height: 56px;
  padding: 0 32px;
  font: var(--md-sys-typescale-title-medium);
}

.spinner {
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-primary);
  animation: spinner-spin 0.8s linear infinite;
}

.spinner--small {
  width: 14px;
  height: 14px;
  border-width: 2px;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 向导底部导航与步骤切换动画 */
.wizard__nav {
  display: flex;
  align-items: center;
  padding-top: 24px;
  max-width: 560px;
}

.wizard__nav-spacer {
  flex: 1;
}

.wizard-slide-enter-active,
.wizard-slide-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized);
}

.wizard-slide-enter-from {
  opacity: 0;
  transform: translateX(24px);
}

.wizard-slide-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
</style>
