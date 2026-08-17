<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useInstancesStore } from '@/stores/instances';
import { useSettingsStore } from '@/stores/settings';
import { mofoxApi } from '@/services/mofox-api';
import ErrorDialog from '@/components/ErrorDialog.vue';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';

type Step = 1 | 2 | 3;
type Direction = 'forward' | 'backward';

const STEPS = ['欢迎', 'Neo-MoFox 信息', '平台信息'];

const emit = defineEmits<{
  close: [];
  complete: [];
}>();

const settingsStore = useSettingsStore();
const instancesStore = useInstancesStore();

const currentStep = ref<Step>(1);
const direction = ref<Direction>('forward');
const instanceName = ref('');
const mofoxInstallDir = ref('');
const platforms = ref<BotPlatformMetadata[]>([]);
const platformsLoading = ref(false);
const platformError = ref<string | null>(null);
const includePlatform = ref(false);
const platformId = ref('');
const platformDir = ref('');
const busy = ref(false);
const completed = ref(false);

// 最终导入失败时通过错误弹窗展示；输入时的校验错误直接内联在对应字段下。
const importError = ref<Error | null>(null);
const showErrorDialog = ref(false);

// 名称在输入时即时校验；目录则防抖调用主进程探测路径。
const nameTouched = ref(false);
const nameError = computed(() => {
  const trimmed = instanceName.value.trim();
  if (!trimmed) return '实例名称不能为空';
  if (trimmed.length > 32) return '实例名称不能超过 32 个字符';
  return '';
});

interface PathValidationState {
  touched: boolean;
  checking: boolean;
  error: string;
}

/** 目录校验状态机：输入即标记已触碰，防抖 400ms 后调用主进程探测路径。 */
function createPathValidation(
  check: (value: string) => Promise<string>,
  emptyMessage: string,
) {
  const state = reactive<PathValidationState>({ touched: false, checking: false, error: '' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;

  function run(value: string): void {
    const trimmed = value.trim();
    const current = ++token;
    if (timer) clearTimeout(timer);
    if (!trimmed) {
      state.checking = false;
      state.error = emptyMessage;
      return;
    }
    state.checking = true;
    timer = setTimeout(async () => {
      let error: string;
      try {
        error = await check(trimmed);
      } catch {
        error = '目录校验失败，请稍后重试';
      }
      // 输入持续变化时丢弃过期探测结果。
      if (current !== token) return;
      state.error = error;
      state.checking = false;
    }, 400);
  }

  return {
    state,
    markTouched: () => {
      state.touched = true;
    },
    run,
  };
}

const mofoxDirPath = createPathValidation(async (value) => {
  const check = await mofoxApi.inspectImportPath(value);
  if (!check.absolute) return '请输入绝对路径';
  if (!check.exists) return '目录不存在';
  if (!check.isDirectory) return '必须是目录';
  if (!check.mainPyExists) return '不是有效的 Neo-MoFox 安装目录（缺少 main.py）';
  return '';
}, 'Neo-MoFox 安装目录不能为空');

const platformDirPath = createPathValidation(async (value) => {
  const check = await mofoxApi.inspectImportPath(value);
  if (!check.absolute) return '请输入绝对路径';
  if (!check.exists) return '目录不存在';
  if (!check.isDirectory) return '必须是目录';
  return '';
}, '平台安装目录不能为空');

const showNameError = computed(() => nameTouched.value && nameError.value !== '');
const showMofoxDirError = computed(
  () => mofoxDirPath.state.touched && mofoxDirPath.state.error !== '',
);
const showPlatformDirError = computed(
  () => platformDirPath.state.touched && platformDirPath.state.error !== '',
);

const currentPlatform = computed(
  () => platforms.value.find((platform) => platform.id === platformId.value) ?? null,
);
const canContinue = computed(() => {
  if (currentStep.value === 1) return true;
  if (currentStep.value === 2) {
    return (
      nameError.value === '' &&
      mofoxInstallDir.value.trim() !== '' &&
      !mofoxDirPath.state.checking &&
      mofoxDirPath.state.error === ''
    );
  }
  return (
    !includePlatform.value ||
    (Boolean(platformId.value && platformDir.value.trim()) &&
      !platformDirPath.state.checking &&
      platformDirPath.state.error === '')
  );
});

function onPlatformChange(event: Event): void {
  platformId.value = (event.target as HTMLSelectElement).value;
}

function onNameInput(): void {
  nameTouched.value = true;
}

function onMofoxDirInput(): void {
  mofoxDirPath.markTouched();
  mofoxDirPath.run(mofoxInstallDir.value);
}

function onPlatformDirInput(): void {
  platformDirPath.markTouched();
  platformDirPath.run(platformDir.value);
}

function next(): void {
  if (!canContinue.value || currentStep.value === 3) return;
  direction.value = 'forward';
  currentStep.value = (currentStep.value + 1) as Step;
}

function back(): void {
  if (currentStep.value === 1) return;
  direction.value = 'backward';
  currentStep.value = (currentStep.value - 1) as Step;
}

function pathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

async function chooseMofoxDirectory(): Promise<void> {
  const selected = await mofoxApi.pickDirectory({
    title: '选择 Neo-MoFox 安装目录',
    defaultPath: mofoxInstallDir.value || settingsStore.settings.defaultInstallDir || undefined,
  });
  if (!selected) return;
  mofoxInstallDir.value = selected;
  if (!instanceName.value.trim()) instanceName.value = pathName(selected);
  mofoxDirPath.markTouched();
  mofoxDirPath.run(mofoxInstallDir.value);
}

async function choosePlatformDirectory(): Promise<void> {
  const selected = await mofoxApi.pickDirectory({
    title: '选择平台安装目录',
    defaultPath: platformDir.value || undefined,
  });
  if (!selected) return;
  platformDir.value = selected;
  platformDirPath.markTouched();
  platformDirPath.run(platformDir.value);
}

async function submit(): Promise<void> {
  if (!canContinue.value || busy.value) return;
  busy.value = true;
  importError.value = null;
  showErrorDialog.value = false;
  try {
    await mofoxApi.manualImportInstance({
      instanceName: instanceName.value.trim(),
      mofoxInstallDir: mofoxInstallDir.value.trim(),
      ...(includePlatform.value
        ? { platformId: platformId.value, platformDir: platformDir.value.trim() }
        : {}),
    });
    await instancesStore.refresh();
    completed.value = true;
  } catch (error) {
    importError.value = error instanceof Error ? error : new Error(String(error));
    showErrorDialog.value = true;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  platformsLoading.value = true;
  try {
    platforms.value = await mofoxApi.listBotPlatforms();
  } catch (error) {
    platformError.value = error instanceof Error ? error.message : '平台列表加载失败';
  } finally {
    platformsLoading.value = false;
  }
});
</script>

<template>
  <div class="manual-import">
    <aside class="manual-import__rail">
      <ol class="stepper" aria-label="导入步骤">
        <li
          v-for="(label, index) in STEPS"
          :key="label"
          class="stepper__item"
          :class="{
            'stepper__item--done': index + 1 < currentStep,
            'stepper__item--current': index + 1 === currentStep,
          }"
        >
          <span class="stepper__marker" aria-hidden="true">
            <span v-if="index + 1 < currentStep" class="msr msr--fill">check</span>
            <span v-else>{{ index + 1 }}</span>
          </span>
          <span class="stepper__title">{{ label }}</span>
          <span v-if="index < STEPS.length - 1" class="stepper__line"></span>
        </li>
      </ol>

      <!-- 取消/上一步按钮固定在侧栏左下角 -->
      <div class="manual-import__rail-back">
        <button
          v-if="currentStep === 1"
          type="button"
          class="btn btn--tonal state-layer"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          v-else
          type="button"
          class="btn btn--tonal state-layer"
          :disabled="busy"
          @click="back"
        >
          上一步
        </button>
      </div>
    </aside>

    <div class="manual-import__panel">
      <Transition :name="`manual-import-slide-${direction}`" mode="out-in">
        <section :key="currentStep" class="step">
          <template v-if="currentStep === 1">
            <div class="welcome-mark" aria-hidden="true">
              <span class="msr msr--fill">folder_copy</span>
            </div>
            <p class="step__eyebrow">已有实例</p>
            <h2 class="step__title">导入你的 Neo-MoFox</h2>
            <p class="step__desc">
              此流程只会把已有目录登记到启动器中，不会下载、移动或修改其中的文件。
            </p>
            <div class="info-card">
              <span class="msr" aria-hidden="true">info</span>
              <span>请准备 Neo-MoFox 主程序目录；平台目录可以在下一步选择，也可以暂时跳过。</span>
            </div>
          </template>

          <template v-else-if="currentStep === 2">
            <p class="step__eyebrow">第 2 步</p>
            <h2 class="step__title">Neo-MoFox 信息</h2>
            <p class="step__desc">选择已安装的 Neo-MoFox 目录，并设置它在启动器中的名称。</p>

            <label class="field" :class="{ 'field--error': showNameError }">
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
            <p v-if="showNameError" class="field__support field__support--error">
              {{ nameError }}
            </p>

            <div class="path-field">
              <label
                class="field field--grow"
                :class="{ 'field--error': showMofoxDirError }"
              >
                <input
                  v-model="mofoxInstallDir"
                  class="field__input"
                  type="text"
                  placeholder=" "
                  @input="onMofoxDirInput"
                />
                <span class="field__label">Neo-MoFox 安装目录</span>
              </label>
              <button
                type="button"
                class="btn btn--tonal state-layer"
                :disabled="mofoxDirPath.state.checking"
                @click="chooseMofoxDirectory"
              >
                <span class="msr" aria-hidden="true">folder_open</span>
                浏览
              </button>
            </div>
            <p class="field__support" :class="{ 'field__support--error': showMofoxDirError }">
              <template v-if="mofoxDirPath.state.checking">正在校验目录…</template>
              <template v-else-if="showMofoxDirError">
                {{ mofoxDirPath.state.error }}
              </template>
              <template v-else-if="mofoxDirPath.state.touched">✓ 目录有效</template>
              <template v-else>目录内需要包含 Neo-MoFox 的 <code>main.py</code> 文件。</template>
            </p>
          </template>

          <template v-else>
            <p class="step__eyebrow">第 3 步</p>
            <h2 class="step__title">平台信息</h2>
            <p class="step__desc">如果这个实例已经配有机器人平台，可以一并登记其目录。</p>

            <label class="platform-toggle state-layer">
              <input v-model="includePlatform" type="checkbox" class="platform-toggle__input" />
              <span class="platform-toggle__box">
                <span class="msr msr--fill" aria-hidden="true">check</span>
              </span>
              <span class="platform-toggle__text">
                <span class="platform-toggle__title">导入已安装的平台</span>
                <span class="platform-toggle__desc">不勾选时将只导入 Neo-MoFox 主程序</span>
              </span>
            </label>

            <Transition name="platform-fields">
              <div v-if="includePlatform" class="platform-fields">
                <div v-if="platformsLoading" class="loading-row">
                  <span class="spinner" aria-hidden="true"></span>
                  正在加载可用平台…
                </div>
                <p v-else-if="platformError" class="error-message">{{ platformError }}</p>
                <template v-else>
                  <md-outlined-select
                    class="platform-select"
                    label="平台"
                    :value="platformId"
                    @change="onPlatformChange"
                  >
                    <!-- Material Web Components 使用原生具名插槽，而不是 Vue 模板插槽。 -->
                    <!-- eslint-disable vue/no-deprecated-slot-attribute -->
                    <md-select-option
                      v-for="platform in platforms"
                      :key="platform.id"
                      :value="platform.id"
                    >
                      <div slot="headline">{{ platform.name }}</div>
                    </md-select-option>
                    <!-- eslint-enable vue/no-deprecated-slot-attribute -->
                  </md-outlined-select>
                  <p v-if="currentPlatform" class="platform-hint">
                    {{ currentPlatform.description }}
                  </p>

                  <div class="path-field">
                    <label
                      class="field field--grow"
                      :class="{ 'field--error': showPlatformDirError }"
                    >
                      <input
                        v-model="platformDir"
                        class="field__input"
                        type="text"
                        placeholder=" "
                        @input="onPlatformDirInput"
                      />
                      <span class="field__label"
                        >{{ currentPlatform?.name ?? '平台' }}安装目录</span
                      >
                    </label>
                    <button
                      type="button"
                      class="btn btn--tonal state-layer"
                      :disabled="platformDirPath.state.checking"
                      @click="choosePlatformDirectory"
                    >
                      <span class="msr" aria-hidden="true">folder_open</span>
                      浏览
                    </button>
                  </div>
                  <p
                    class="field__support"
                    :class="{ 'field__support--error': showPlatformDirError }"
                  >
                    <template v-if="platformDirPath.state.checking">正在校验目录…</template>
                    <template v-else-if="showPlatformDirError">
                      {{ platformDirPath.state.error }}
                    </template>
                    <template v-else-if="platformDirPath.state.touched">✓ 目录有效</template>
                    <template v-else>平台目录需为已存在的安装目录。</template>
                  </p>
                </template>
              </div>
            </Transition>

            <div v-if="completed" class="success-message">
              <span class="msr msr--fill" aria-hidden="true">check_circle</span>
              实例已导入完成。
            </div>
          </template>
        </section>
      </Transition>

      <div class="manual-import__nav">
        <span class="manual-import__nav-spacer"></span>
        <button
          v-if="currentStep < 3"
          type="button"
          class="btn btn--filled state-layer"
          :disabled="!canContinue"
          @click="next"
        >
          继续
        </button>
        <button
          v-else-if="completed"
          type="button"
          class="btn btn--filled state-layer"
          @click="emit('complete')"
        >
          查看实例
        </button>
        <button
          v-else
          type="button"
          class="btn btn--filled state-layer"
          :disabled="!canContinue || busy || (includePlatform && Boolean(platformError))"
          @click="submit"
        >
          <span v-if="busy" class="spinner spinner--small" aria-hidden="true"></span>
          {{ busy ? '正在导入' : '开始导入' }}
        </button>
      </div>
    </div>

    <!-- 最终导入失败时弹出错误对话框 -->
    <ErrorDialog
      :open="showErrorDialog"
      title="导入失败"
      :description="importError ? importError.message : '导入失败，请稍后重试'"
      :stack="importError?.stack"
      @close="showErrorDialog = false"
    />
  </div>
</template>

<style scoped>
.manual-import {
  display: flex;
  height: 100%;
  min-height: 0;
}

.manual-import__rail {
  width: 230px;
  flex: 0 0 230px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 40px 24px 28px;
  border-right: 1px solid var(--app-glass-border);
  background: var(--app-subrail-surface);
  backdrop-filter: var(--app-subrail-filter);
  -webkit-backdrop-filter: var(--app-subrail-filter);
}

.stepper {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* 取消/上一步按钮固定在侧栏左下角 */
.manual-import__rail-back {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-top: auto;
  padding-top: 24px;
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
  z-index: 1;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
}

.stepper__marker .msr {
  font-size: 18px;
}

.stepper__item--done .stepper__marker {
  border-color: transparent;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.stepper__item--current .stepper__marker {
  border: 2px solid var(--md-sys-color-primary);
  color: var(--md-sys-color-primary);
}

.stepper__title {
  padding-top: 6px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-title-small);
}

.stepper__item--current .stepper__title {
  color: var(--md-sys-color-on-surface);
}

.stepper__line {
  position: absolute;
  top: 32px;
  bottom: 0;
  left: 15px;
  width: 2px;
  background: var(--md-sys-color-outline-variant);
}

.stepper__item--done .stepper__line {
  background: var(--md-sys-color-primary);
}

.manual-import__panel {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding: 40px 48px;
  background: var(--app-current-content-surface);
  backdrop-filter: var(--app-current-content-filter);
  -webkit-backdrop-filter: var(--app-current-content-filter);
  overflow: hidden;
}

/* 内容画布之下铺设固定不透明度的底色，避免壁纸背景透明度被调为零时内容失去衬底、可读性骤降。 */
.manual-import__panel::before {
  content: '';
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--md-sys-color-surface) 82%, transparent);
  pointer-events: none;
  border-radius: inherit;
}

.manual-import__panel > .step,
.manual-import__panel > .manual-import__nav {
  position: relative;
  z-index: 1;
}

.step {
  width: min(100%, 560px);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.step__eyebrow {
  margin: 0 0 8px;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.step__title {
  margin: 0 0 8px;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-headline-small);
}

.step__desc {
  margin: 0 0 28px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-large);
  line-height: 1.55;
}

.welcome-mark {
  display: grid;
  width: 72px;
  height: 72px;
  margin-bottom: 28px;
  place-items: center;
  border-radius: 24px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.welcome-mark .msr {
  font-size: 38px;
}

.info-card,
.success-message {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
  line-height: 1.5;
}

.info-card .msr {
  flex: none;
  color: var(--md-sys-color-primary);
}

.field {
  position: relative;
  display: block;
  height: 56px;
  margin-bottom: 20px;
}

.field--grow {
  min-width: 0;
  flex: 1;
  margin-bottom: 0;
}

.field__input {
  width: 100%;
  height: 100%;
  padding: 20px 16px 6px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-small);
  outline: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
}

.field__input:focus {
  padding: 19px 15px 5px;
  border: 2px solid var(--md-sys-color-primary);
}

.field__label {
  position: absolute;
  top: 50%;
  left: 16px;
  padding: 0 4px;
  transform: translateY(-50%);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-large);
  pointer-events: none;
  transition:
    transform 200ms cubic-bezier(0.23, 1, 0.32, 1),
    color 200ms cubic-bezier(0.23, 1, 0.32, 1);
}

.field__input:focus + .field__label,
.field__input:not(:placeholder-shown) + .field__label {
  transform: translateY(calc(-50% - 28px)) scale(0.85);
}

.field__input:focus + .field__label {
  color: var(--md-sys-color-primary);
}

.field--error .field__input {
  border-color: var(--md-sys-color-error);
}

.field--error .field__input:focus {
  border-color: var(--md-sys-color-error);
}

.field--error .field__label {
  color: var(--md-sys-color-error);
}

.path-field {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 6px;
}

/* 浏览按钮与输入框同高对齐 */
.path-field .btn {
  height: 56px;
}

.field__support {
  margin: 0 0 20px 16px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.field__support--error {
  color: var(--md-sys-color-error);
}

.field__support code {
  font-family: var(--md-ref-typeface-mono);
}

.platform-toggle {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-large);
  cursor: pointer;
}

.platform-toggle__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.platform-toggle__box {
  display: grid;
  width: 20px;
  height: 20px;
  flex: none;
  place-items: center;
  border: 2px solid var(--md-sys-color-outline);
  border-radius: 4px;
  color: transparent;
}

.platform-toggle__box .msr {
  font-size: 16px;
}

.platform-toggle__input:checked + .platform-toggle__box {
  border-color: var(--md-sys-color-primary);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.platform-toggle__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.platform-toggle__title {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-small);
}

.platform-toggle__desc,
.platform-hint {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.platform-fields {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 18px;
}

.platform-select {
  display: block;
  width: 100%;
}

.loading-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--md-sys-color-on-surface-variant);
}

.error-message {
  margin: 16px 0 0;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-medium);
}

.success-message {
  margin-top: 18px;
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.success-message .msr {
  color: inherit;
}

.manual-import__nav {
  display: flex;
  align-items: center;
  width: 100%;
  padding-top: 24px;
}

.manual-import__nav-spacer {
  flex: 1;
}

.btn {
  position: relative;
  display: inline-flex;
  height: 40px;
  align-items: center;
  justify-content: center;
  gap: 8px;
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
  padding: 0 12px;
  background: transparent;
  color: var(--md-sys-color-primary);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-primary);
  border-radius: var(--md-sys-shape-corner-full);
  animation: spinner-spin 0.8s linear infinite;
}

.spinner--small {
  width: 14px;
  height: 14px;
  border-color: color-mix(in srgb, var(--md-sys-color-on-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-on-primary);
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

.manual-import-slide-forward-enter-active,
.manual-import-slide-forward-leave-active,
.manual-import-slide-backward-enter-active,
.manual-import-slide-backward-leave-active,
.platform-fields-enter-active,
.platform-fields-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized);
}

.manual-import-slide-forward-enter-from,
.manual-import-slide-backward-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.manual-import-slide-forward-leave-to,
.manual-import-slide-backward-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}

.platform-fields-enter-from,
.platform-fields-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 720px) {
  .manual-import {
    flex-direction: column;
  }

  .manual-import__rail {
    width: 100%;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: 16px;
    padding: 12px 20px;
    border-right: none;
    border-bottom: 1px solid var(--app-glass-border);
  }

  .stepper {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 16px;
    overflow-x: auto;
  }

  .manual-import__rail-back {
    flex: 0 0 auto;
    margin-top: 0;
    padding-top: 0;
    padding-left: 12px;
    border-left: 1px solid var(--app-glass-border);
  }

  .stepper__item {
    flex: 0 0 auto;
    align-items: center;
    padding: 0;
  }

  .stepper__title {
    padding-top: 0;
  }

  .stepper__line {
    display: none;
  }

  .manual-import__panel {
    padding: 24px 20px;
  }

  .path-field {
    flex-direction: column;
  }

  .path-field .btn {
    align-self: flex-end;
  }
}

@media (prefers-reduced-motion: reduce) {
  .manual-import-slide-forward-enter-active,
  .manual-import-slide-forward-leave-active,
  .manual-import-slide-backward-enter-active,
  .manual-import-slide-backward-leave-active,
  .platform-fields-enter-active,
  .platform-fields-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .manual-import-slide-forward-enter-from,
  .manual-import-slide-forward-leave-to,
  .manual-import-slide-backward-enter-from,
  .manual-import-slide-backward-leave-to,
  .platform-fields-enter-from,
  .platform-fields-leave-to {
    transform: none;
  }

  .spinner {
    animation: none;
  }
}
</style>
