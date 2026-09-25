<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useInstancesStore } from '@/stores/instances';
import { useSettingsStore } from '@/stores/settings';
import { mofoxApi } from '@/services/mofox-api';
import ErrorDialog from '@/components/ErrorDialog.vue';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import InstallerTaskShell, { type TaskPhase } from './InstallerTaskShell.vue';
import '@/components/install/install-wizard.css';

type Step = 1 | 2 | 3;

const PHASES: TaskPhase[] = [
  { id: 'welcome', label: '说明', icon: 'waving_hand' },
  { id: 'mofox', label: '主程序', icon: 'smart_toy' },
  { id: 'platform', label: '平台', icon: 'hub' },
];

const emit = defineEmits<{
  close: [];
  complete: [];
}>();

const settingsStore = useSettingsStore();
const instancesStore = useInstancesStore();

const currentStep = ref<Step>(1);
const instanceName = ref('');
const mofoxInstallDir = ref('');
const venvDir = ref('');
const platforms = ref<BotPlatformMetadata[]>([]);
const platformsLoading = ref(false);
const platformError = ref<string | null>(null);
const includePlatform = ref(false);
const platformId = ref('');
const platformDir = ref('');
const busy = ref(false);
const completed = ref(false);

const importError = ref<Error | null>(null);
const showErrorDialog = ref(false);
const nameError = ref('');
const mofoxDirError = ref('');
const venvDirError = ref('');
const platformDirError = ref('');
const checkingMofoxDir = ref(false);
const checkingVenvDir = ref(false);
const checkingPlatformDir = ref(false);
const validating = ref(false);

const showNameError = computed(() => nameError.value !== '');
const showMofoxDirError = computed(() => mofoxDirError.value !== '');
const showVenvDirError = computed(() => venvDirError.value !== '');
const showPlatformDirError = computed(() => platformDirError.value !== '');
const activePhase = computed(() => PHASES[currentStep.value - 1]?.id ?? 'welcome');
const shellTitle = computed(() => {
  if (completed.value) return `${instanceName.value || 'Neo-MoFox'} 已导入`;
  if (currentStep.value === 1) return '导入已有实例';
  return instanceName.value.trim() || '登记 Neo-MoFox';
});
const shellSubtitle = computed(() => {
  if (completed.value) return '目录与实例信息已登记，可以直接前往实例页。';
  if (currentStep.value === 1) return '只登记现有文件，不下载、不移动，也不改写主程序目录。';
  if (currentStep.value === 2) return '确认主程序与 Python 虚拟环境所在位置。';
  return '平台是可选项；稍后也可以在实例管理中补充。';
});
const shellIcon = computed(() => (completed.value ? 'check_circle' : 'folder_copy'));
const phaseBadge = computed(() => (completed.value ? '已完成' : `${currentStep.value} / 3`));

function defaultVenvDirFor(mofoxDir: string): string {
  return mofoxDir ? `${mofoxDir.replace(/[\\/]+$/, '')}\\.venv` : '';
}

function followVenvDefaultIfNeeded(nextMofox: string): void {
  const current = venvDir.value.trim();
  if (!current || current === defaultVenvDirFor(mofoxInstallDir.value.trim())) {
    venvDir.value = defaultVenvDirFor(nextMofox);
  }
}

watch(mofoxInstallDir, (next, previous) => {
  const nextTrimmed = next.trim();
  const previousTrimmed = previous?.trim() ?? '';
  if (!nextTrimmed || nextTrimmed === previousTrimmed) return;
  const previousDefault = defaultVenvDirFor(previousTrimmed);
  const currentVenv = venvDir.value.trim();
  if (!currentVenv || currentVenv === previousDefault) {
    venvDir.value = defaultVenvDirFor(nextTrimmed);
  }
});

function validateName(): boolean {
  nameError.value = instanceName.value.trim() ? '' : '实例名称不能为空';
  return nameError.value === '';
}

async function validateMofoxDir(): Promise<boolean> {
  const value = mofoxInstallDir.value.trim();
  if (!value) {
    mofoxDirError.value = 'Neo-MoFox 安装目录不能为空';
    return false;
  }
  mofoxDirError.value = '';
  checkingMofoxDir.value = true;
  try {
    const check = await mofoxApi.inspectImportPath(value);
    if (!check.absolute) mofoxDirError.value = '请输入绝对路径';
    else if (!check.exists) mofoxDirError.value = '目录不存在';
    else if (!check.isDirectory) mofoxDirError.value = '必须是目录';
    else if (!check.mainPyExists) {
      mofoxDirError.value = '不是有效的 Neo-MoFox 安装目录（缺少 main.py）';
    }
  } catch {
    mofoxDirError.value = '目录校验失败，请稍后重试';
  } finally {
    checkingMofoxDir.value = false;
  }
  return mofoxDirError.value === '';
}

async function validateVenvDir(): Promise<boolean> {
  const value = venvDir.value.trim();
  if (!value) {
    venvDirError.value = '虚拟环境路径不能为空';
    return false;
  }
  venvDirError.value = '';
  checkingVenvDir.value = true;
  try {
    const check = await mofoxApi.inspectVenvPath(value);
    if (!check.absolute) venvDirError.value = '请输入绝对路径';
    else if (check.exists && !check.isDirectory) venvDirError.value = '必须是目录';
  } catch (error) {
    venvDirError.value = error instanceof Error ? error.message : '目录校验失败，请稍后重试';
  } finally {
    checkingVenvDir.value = false;
  }
  return venvDirError.value === '';
}

async function validatePlatformDir(): Promise<boolean> {
  if (!includePlatform.value) return true;
  const value = platformDir.value.trim();
  if (!value) {
    platformDirError.value = '平台安装目录不能为空';
    return false;
  }
  if (!platformId.value) {
    platformDirError.value = '请先选择平台';
    return false;
  }
  platformDirError.value = '';
  checkingPlatformDir.value = true;
  try {
    const check = await mofoxApi.inspectPlatformImportPath(platformId.value, value);
    if (!check.absolute) platformDirError.value = '请输入绝对路径';
    else if (!check.exists) platformDirError.value = '目录不存在';
    else if (!check.isDirectory) platformDirError.value = '必须是目录';
    else if (!check.valid) platformDirError.value = '不是有效的平台安装目录';
  } catch {
    platformDirError.value = '目录校验失败，请稍后重试';
  } finally {
    checkingPlatformDir.value = false;
  }
  return platformDirError.value === '';
}

const currentPlatform = computed(
  () => platforms.value.find((platform) => platform.id === platformId.value) ?? null,
);
const navDisabled = computed(() => validating.value || busy.value);

function onPlatformChange(event: Event): void {
  platformId.value = (event.target as HTMLSelectElement).value;
  platformDirError.value = '';
}

function onNameFocus(): void {
  nameError.value = '';
}

function onMofoxDirFocus(): void {
  mofoxDirError.value = '';
}

function onVenvDirFocus(): void {
  venvDirError.value = '';
}

function onPlatformDirFocus(): void {
  platformDirError.value = '';
}

async function next(): Promise<void> {
  if (currentStep.value === 3 || navDisabled.value) return;
  validating.value = true;
  try {
    let valid = true;
    if (currentStep.value === 2) {
      valid = validateName();
      valid = (await validateMofoxDir()) && valid;
      valid = (await validateVenvDir()) && valid;
    }
    if (valid) currentStep.value = (currentStep.value + 1) as Step;
  } finally {
    validating.value = false;
  }
}

function back(): void {
  if (currentStep.value > 1) currentStep.value = (currentStep.value - 1) as Step;
}

function selectPhase(id: string): void {
  const index = PHASES.findIndex((phase) => phase.id === id);
  if (index < 0 || index + 1 >= currentStep.value || busy.value || completed.value) return;
  currentStep.value = (index + 1) as Step;
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
  followVenvDefaultIfNeeded(selected);
  mofoxInstallDir.value = selected;
  mofoxDirError.value = '';
  if (!instanceName.value.trim()) instanceName.value = pathName(selected);
}

async function chooseVenvDirectory(): Promise<void> {
  const selected = await mofoxApi.pickDirectory({
    title: '选择虚拟环境目录',
    defaultPath: venvDir.value || defaultVenvDirFor(mofoxInstallDir.value.trim()) || undefined,
  });
  if (!selected) return;
  venvDir.value = selected;
  venvDirError.value = '';
}

async function choosePlatformDirectory(): Promise<void> {
  const selected = await mofoxApi.pickDirectory({
    title: '选择平台安装目录',
    defaultPath: platformDir.value || undefined,
  });
  if (!selected) return;
  platformDir.value = selected;
  platformDirError.value = '';
}

async function submit(): Promise<void> {
  if (navDisabled.value) return;
  validating.value = true;
  try {
    if (!(await validatePlatformDir())) return;
    busy.value = true;
    importError.value = null;
    showErrorDialog.value = false;
    try {
      await mofoxApi.manualImportInstance({
        instanceName: instanceName.value.trim(),
        mofoxInstallDir: mofoxInstallDir.value.trim(),
        venvDir: venvDir.value.trim() || defaultVenvDirFor(mofoxInstallDir.value.trim()),
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
  } finally {
    validating.value = false;
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
    <InstallerTaskShell
      :title="shellTitle"
      :subtitle="shellSubtitle"
      :icon="shellIcon"
      :phases="PHASES"
      :active-phase="activePhase"
      :navigable="!completed"
      @select-phase="selectPhase"
    >
      <template #badge>
        <span class="import-badge" :class="{ 'import-badge--done': completed }">
          {{ phaseBadge }}
        </span>
      </template>

      <section v-if="completed" class="import-result">
        <span class="import-result__mark" aria-hidden="true">
          <span class="msr msr--fill">check_circle</span>
        </span>
        <p class="manual-screen__eyebrow">导入完成</p>
        <h2>{{ instanceName }} 已登记</h2>
        <p>启动器已保存主程序、虚拟环境{{ includePlatform ? '与平台' : '' }}目录。</p>
        <div class="import-result__facts">
          <span><span class="msr" aria-hidden="true">folder</span>{{ mofoxInstallDir }}</span>
          <span v-if="includePlatform">
            <span class="msr" aria-hidden="true">hub</span>{{ currentPlatform?.name ?? platformId }}
          </span>
        </div>
      </section>

      <section v-else-if="currentStep === 1" class="manual-screen manual-welcome">
        <p class="manual-screen__eyebrow">本机已有 Neo-MoFox</p>
        <h2>把现有实例接入启动器</h2>
        <p class="manual-screen__description">
          导入只建立管理记录。Neo-MoFox 主程序、配置与虚拟环境都留在原处，不会被复制或改写。
        </p>

        <div class="welcome-list">
          <div class="welcome-list__item">
            <span class="welcome-list__icon"><span class="msr">smart_toy</span></span>
            <span><strong>主程序目录</strong><small>需要包含可识别的 main.py</small></span>
          </div>
          <div class="welcome-list__item">
            <span class="welcome-list__icon"><span class="msr">code</span></span>
            <span><strong>Python 环境</strong><small>默认识别主程序目录下的 .venv</small></span>
          </div>
          <div class="welcome-list__item">
            <span class="welcome-list__icon"><span class="msr">hub</span></span>
            <span><strong>机器人平台</strong><small>可选，之后也能在实例管理中补充</small></span>
          </div>
        </div>

        <div class="info-card">
          <span class="msr" aria-hidden="true">info</span>
          <span>如果目录来自移动硬盘，请先确认盘符不会频繁变化。</span>
        </div>
      </section>

      <section v-else-if="currentStep === 2" class="manual-screen">
        <p class="manual-screen__eyebrow">主程序</p>
        <h2>确认 Neo-MoFox 信息</h2>
        <p class="manual-screen__description">名称用于启动器内识别；两个路径会在继续时实际校验。</p>

        <div class="manual-fields">
          <div class="form-group">
            <label class="field" :class="{ 'field--error': showNameError }">
              <input
                v-model="instanceName"
                class="field__input"
                type="text"
                placeholder=" "
                maxlength="32"
                @focus="onNameFocus"
              />
              <span class="field__label">实例名称</span>
            </label>
            <p v-if="showNameError" class="field__support field__support--error">{{ nameError }}</p>
          </div>

          <div class="form-group">
            <div class="path-field">
              <label class="field field--grow" :class="{ 'field--error': showMofoxDirError }">
                <input
                  v-model="mofoxInstallDir"
                  class="field__input"
                  type="text"
                  placeholder=" "
                  @focus="onMofoxDirFocus"
                />
                <span class="field__label">Neo-MoFox 安装目录</span>
              </label>
              <button
                type="button"
                class="btn btn--tonal state-layer"
                @click="chooseMofoxDirectory"
              >
                <span class="msr" aria-hidden="true">folder_open</span>浏览
              </button>
            </div>
            <p v-if="showMofoxDirError" class="field__support field__support--error">
              {{ mofoxDirError }}
            </p>
            <p v-else class="field__support">
              {{
                checkingMofoxDir ? '正在校验目录…' : '目录内需要包含 Neo-MoFox 的 main.py 文件。'
              }}
            </p>
          </div>

          <div class="form-group">
            <div class="path-field">
              <label class="field field--grow" :class="{ 'field--error': showVenvDirError }">
                <input
                  v-model="venvDir"
                  class="field__input"
                  type="text"
                  placeholder=" "
                  @focus="onVenvDirFocus"
                />
                <span class="field__label">虚拟环境路径</span>
              </label>
              <button type="button" class="btn btn--tonal state-layer" @click="chooseVenvDirectory">
                <span class="msr" aria-hidden="true">folder_open</span>浏览
              </button>
            </div>
            <p v-if="showVenvDirError" class="field__support field__support--error">
              {{ venvDirError }}
            </p>
            <p v-else class="field__support">
              {{ checkingVenvDir ? '正在校验目录…' : '默认使用主程序目录下的 .venv。' }}
            </p>
          </div>
        </div>
      </section>

      <section v-else class="manual-screen">
        <p class="manual-screen__eyebrow">可选平台</p>
        <h2>是否一并登记机器人平台？</h2>
        <p class="manual-screen__description">只导入主程序也可以正常完成，平台信息之后仍可修改。</p>

        <label class="platform-toggle state-layer">
          <input v-model="includePlatform" type="checkbox" class="platform-toggle__input" />
          <span class="platform-toggle__mark" aria-hidden="true">
            <span class="msr msr--fill">{{ includePlatform ? 'check_circle' : 'hub' }}</span>
          </span>
          <span class="platform-toggle__text">
            <strong>导入已安装的平台</strong>
            <small>{{
              includePlatform ? '选择平台类型和它的安装目录' : '关闭时仅登记 Neo-MoFox 主程序'
            }}</small>
          </span>
          <span class="platform-toggle__state">{{ includePlatform ? '已开启' : '跳过' }}</span>
        </label>

        <div class="platform-fields" :class="{ 'platform-fields--open': includePlatform }">
          <div class="platform-fields__clip">
            <div class="platform-fields__content">
              <div v-if="platformsLoading" class="loading-row">
                <span class="spinner" aria-hidden="true"></span>正在加载可用平台…
              </div>
              <p v-else-if="platformError" class="error-message-card">{{ platformError }}</p>
              <template v-else>
                <md-outlined-select
                  class="platform-select"
                  label="平台"
                  :value="platformId"
                  @change="onPlatformChange"
                >
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

                <div class="form-group">
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
                        @focus="onPlatformDirFocus"
                      />
                      <span class="field__label"
                        >{{ currentPlatform?.name ?? '平台' }}安装目录</span
                      >
                    </label>
                    <button
                      type="button"
                      class="btn btn--tonal state-layer"
                      @click="choosePlatformDirectory"
                    >
                      <span class="msr" aria-hidden="true">folder_open</span>浏览
                    </button>
                  </div>
                  <p v-if="showPlatformDirError" class="field__support field__support--error">
                    {{ platformDirError }}
                  </p>
                  <p v-else class="field__support">
                    {{ checkingPlatformDir ? '正在校验目录…' : '目录需要是可识别的平台安装目录。' }}
                  </p>
                </div>
              </template>
            </div>
          </div>
        </div>
      </section>

      <template #leading-actions>
        <button
          v-if="currentStep === 1 && !completed"
          type="button"
          class="btn btn--text state-layer"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          v-else-if="!completed"
          type="button"
          class="btn btn--text state-layer"
          :disabled="navDisabled"
          @click="back"
        >
          <span class="msr" aria-hidden="true">arrow_back</span>返回
        </button>
      </template>

      <template #actions>
        <button
          v-if="currentStep < 3"
          type="button"
          class="btn btn--filled state-layer"
          :disabled="navDisabled"
          @click="next"
        >
          <span v-if="validating" class="spinner spinner--small" aria-hidden="true"></span>
          {{ validating ? '正在检查' : '继续' }}
          <span v-if="!validating" class="msr" aria-hidden="true">arrow_forward</span>
        </button>
        <button
          v-else-if="completed"
          type="button"
          class="btn btn--filled state-layer"
          @click="emit('complete')"
        >
          查看实例<span class="msr" aria-hidden="true">arrow_forward</span>
        </button>
        <button
          v-else
          type="button"
          class="btn btn--filled state-layer"
          :disabled="navDisabled || (includePlatform && Boolean(platformError))"
          @click="submit"
        >
          <span v-if="busy || validating" class="spinner spinner--small" aria-hidden="true"></span>
          <span v-else class="msr" aria-hidden="true">drive_file_move</span>
          {{ busy ? '正在导入' : validating ? '正在检查' : '开始导入' }}
        </button>
      </template>
    </InstallerTaskShell>

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
  height: 100%;
  min-height: 0;
}

.import-badge {
  padding: 5px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-medium);
}

.import-badge--done {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.manual-screen {
  width: min(100%, 680px);
  margin: 0 auto;
}

.manual-screen__eyebrow,
.manual-screen h2,
.manual-screen__description {
  margin: 0;
}

.manual-screen__eyebrow {
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
}

.manual-screen h2 {
  margin-top: 4px;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-headline-small);
}

.manual-screen__description {
  margin-top: 8px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
  line-height: 1.55;
}

.manual-welcome {
  display: flex;
  flex-direction: column;
}

.welcome-list {
  display: grid;
  gap: 3px;
  margin-top: 24px;
}

.welcome-list__item {
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 6px;
  background: var(--app-glass-row);
}

.welcome-list__item:first-child {
  border-radius: 18px 18px 6px 6px;
}

.welcome-list__item:last-child {
  border-radius: 6px 6px 18px 18px;
}

.welcome-list__icon {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.welcome-list__icon .msr {
  font-size: 22px;
}

.welcome-list__item > span:last-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.welcome-list strong {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-small);
}

.welcome-list small {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.manual-welcome .info-card {
  margin-top: 14px;
}

.manual-fields {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}

.platform-toggle {
  width: 100%;
  min-height: 76px;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  margin-top: 24px;
  padding: 13px 16px;
  border-radius: 18px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.platform-toggle:has(.platform-toggle__input:checked) {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.platform-toggle__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.platform-toggle__mark {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.platform-toggle:has(.platform-toggle__input:checked) .platform-toggle__mark {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.platform-toggle__text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.platform-toggle__text strong {
  font: var(--md-sys-typescale-title-medium);
}

.platform-toggle__text small,
.platform-toggle__state {
  color: inherit;
  font: var(--md-sys-typescale-body-small);
  opacity: 0.76;
}

.platform-toggle__state {
  font-weight: 600;
}

.platform-fields {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard),
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.platform-fields--open {
  grid-template-rows: 1fr;
  opacity: 1;
}

.platform-fields__clip {
  min-height: 0;
  overflow: hidden;
}

.platform-fields__content {
  display: grid;
  gap: 14px;
  margin-top: 12px;
  padding: 18px;
  border-radius: 18px;
  background: var(--app-glass-row);
}

.error-message-card {
  margin: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font: var(--md-sys-typescale-body-medium);
}

.import-result {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}

.import-result__mark {
  width: 76px;
  height: 76px;
  display: grid;
  place-items: center;
  margin-bottom: 8px;
  border-radius: 25px;
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.import-result__mark .msr {
  font-size: 42px;
}

.import-result h2,
.import-result > p {
  margin: 0;
}

.import-result h2 {
  font: var(--md-sys-typescale-headline-small);
}

.import-result > p:not(.manual-screen__eyebrow) {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.import-result__facts {
  width: min(100%, 560px);
  display: grid;
  gap: 3px;
  margin-top: 12px;
  text-align: left;
}

.import-result__facts > span {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-result__facts .msr {
  flex: none;
  font-size: 20px;
}

@media (prefers-reduced-motion: reduce) {
  .platform-fields {
    transition-duration: var(--md-sys-motion-duration-short2);
  }
}

@media (max-width: 620px) {
  .platform-toggle {
    grid-template-columns: 46px minmax(0, 1fr);
  }

  .platform-toggle__state {
    display: none;
  }
}
</style>
