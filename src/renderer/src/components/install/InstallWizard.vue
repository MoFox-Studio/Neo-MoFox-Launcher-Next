<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import BaseDialog from '@/components/BaseDialog.vue';
import { useInstallDraftStore } from '@/stores/install-draft';
import { useInstallStore } from '@/stores/install';
import type { InstallRequest } from '@shared/domain/install';
import InstallerTaskShell, { type TaskPhase } from './InstallerTaskShell.vue';
import InstallLicenseStep from './InstallLicenseStep.vue';
import InstallInstanceStep from './InstallInstanceStep.vue';
import InstallApiKeyStep from './InstallApiKeyStep.vue';
import InstallPlatformStep from './InstallPlatformStep.vue';
import InstallWebuiStep from './InstallWebuiStep.vue';
import InstallLocationStep from './InstallLocationStep.vue';
import InstallSummaryStep from './InstallSummaryStep.vue';
import InstallExecuteStep from './InstallExecuteStep.vue';
import '@/components/install/install-wizard.css';

type PhaseId = 'license' | 'configure' | 'review' | 'execute';
type ConfigSectionId = 'identity' | 'model' | 'network' | 'components' | 'location';

interface ConfigSection {
  id: ConfigSectionId;
  title: string;
  description: string;
  icon: string;
  component: Component;
}

const PHASES: TaskPhase[] = [
  { id: 'license', label: '协议', icon: 'gavel' },
  { id: 'configure', label: '配置', icon: 'tune' },
  { id: 'review', label: '确认', icon: 'fact_check' },
  { id: 'execute', label: '安装', icon: 'rocket_launch' },
];

const CONFIG_SECTIONS: ConfigSection[] = [
  {
    id: 'identity',
    title: '实例身份',
    description: '名称、昵称与 QQ 账号',
    icon: 'badge',
    component: InstallInstanceStep,
  },
  {
    id: 'model',
    title: '模型服务',
    description: '大语言模型访问密钥',
    icon: 'key',
    component: InstallApiKeyStep,
  },
  {
    id: 'network',
    title: '平台与网络',
    description: '适配器、更新通道与端口',
    icon: 'hub',
    component: InstallPlatformStep,
  },
  {
    id: 'components',
    title: '可选组件',
    description: 'WebUI 与访问控制',
    icon: 'widgets',
    component: InstallWebuiStep,
  },
  {
    id: 'location',
    title: '安装位置',
    description: '目标目录与可用空间',
    icon: 'folder_open',
    component: InstallLocationStep,
  },
];

const draftStore = useInstallDraftStore();
const installStore = useInstallStore();

const emit = defineEmits<{
  close: [];
  complete: [];
}>();

const currentPhase = ref<PhaseId>('license');
const activeConfigSection = ref<ConfigSectionId>('identity');
const licenseAgreed = ref(false);
const contentRef = ref<HTMLElement | null>(null);
const confirmingCancel = ref(false);
const cancelling = ref(false);

const phaseIndex = computed(() => PHASES.findIndex((phase) => phase.id === currentPhase.value));

const shellTitle = computed(() => {
  if (currentPhase.value === 'license') return '安装 Neo-MoFox';
  if (currentPhase.value === 'configure') {
    return draftStore.draft.instanceName.trim() || '配置新实例';
  }
  if (currentPhase.value === 'review') return draftStore.draft.instanceName || '确认安装';
  if (installStore.isDone) return `${draftStore.draft.instanceName || 'Neo-MoFox'} 已安装`;
  if (installStore.isFailed) return `${draftStore.draft.instanceName || 'Neo-MoFox'} 安装受阻`;
  return `正在安装${draftStore.draft.instanceName ? ` ${draftStore.draft.instanceName}` : ''}`;
});

const shellSubtitle = computed(() => {
  if (currentPhase.value === 'license') return '先确认许可与隐私条款，再开始配置实例。';
  if (currentPhase.value === 'configure') return '按需展开配置区块，已填写内容会一直保留。';
  if (currentPhase.value === 'review') return '最后检查一次关键配置，确认后即开始安装。';
  if (installStore.isDone) return '文件、依赖与配置已经准备完毕。';
  if (installStore.isFailed) return '已保留任务现场，可以查看详情并从失败步骤重试。';
  return '可以随时展开日志查看细节，安装状态会持续更新。';
});

const shellIcon = computed(() => {
  if (installStore.isDone && currentPhase.value === 'execute') return 'check_circle';
  if (installStore.isFailed && currentPhase.value === 'execute') return 'error';
  return currentPhase.value === 'execute' ? 'deployed_code_update' : 'deployed_code';
});

function sectionReady(id: ConfigSectionId): boolean {
  const errors = draftStore.fieldErrors;
  switch (id) {
    case 'identity':
      return (
        errors.instanceName === '' &&
        errors.botQQ === '' &&
        errors.botNickname === '' &&
        errors.ownerQQ === ''
      );
    case 'model':
      return errors.apiKey === '';
    case 'network':
      return errors.wsPort === '';
    case 'components':
      return errors.webuiKey === '';
    case 'location':
      return errors.targetDir === '' && !draftStore.targetDirCheckError;
  }
}

const configuredCount = computed(
  () => CONFIG_SECTIONS.filter((section) => sectionReady(section.id)).length,
);

const phaseBadge = computed(() => {
  if (currentPhase.value === 'configure') return `${configuredCount.value} / 5 已就绪`;
  if (currentPhase.value === 'review') return '等待确认';
  if (currentPhase.value === 'execute') {
    if (installStore.isDone) return '已完成';
    if (installStore.isFailed) return '需要处理';
    return '安装中';
  }
  return '4 个阶段';
});

const phaseBadgeClass = computed(() => ({
  'task-badge--success': currentPhase.value === 'execute' && installStore.isDone,
  'task-badge--error': currentPhase.value === 'execute' && installStore.isFailed,
}));

function sectionSummary(id: ConfigSectionId): string {
  const draft = draftStore.draft;
  switch (id) {
    case 'identity':
      return draft.instanceName
        ? `${draft.instanceName}${draft.botNickname ? ` · ${draft.botNickname}` : ''}`
        : '需要填写实例名称与账号';
    case 'model':
      return draft.apiKey ? 'API Key 已填写' : '需要填写 API Key';
    case 'network': {
      const platform =
        draft.platformId === 'snowluma'
          ? 'SnowLuma'
          : draft.platformId === 'napcat'
            ? 'NapCat'
            : draft.platformId || '仅核心';
      return `${platform} · ${draft.mofoxBranch} · :${draft.wsPort || '—'}`;
    }
    case 'components':
      return draft.installWebui ? '安装 WebUI' : '仅安装核心组件';
    case 'location':
      return draft.targetDir || '需要选择目标目录';
  }
}

function firstInvalidSection(): ConfigSectionId {
  return CONFIG_SECTIONS.find((section) => !sectionReady(section.id))?.id ?? 'location';
}

function touchConfiguration(): void {
  for (const field of [
    'instanceName',
    'botQQ',
    'botNickname',
    'ownerQQ',
    'apiKey',
    'wsPort',
    'webuiKey',
    'targetDir',
  ]) {
    draftStore.touch(field);
  }
}

function continueFromLicense(): void {
  if (!licenseAgreed.value) return;
  currentPhase.value = 'configure';
}

async function reviewConfiguration(): Promise<void> {
  touchConfiguration();
  if (!draftStore.allValid) {
    activeConfigSection.value = firstInvalidSection();
    return;
  }
  activeConfigSection.value = 'location';
  if (!(await draftStore.validateTargetDirRemote())) return;
  currentPhase.value = 'review';
}

function backOnePhase(): void {
  if (currentPhase.value === 'configure') currentPhase.value = 'license';
  else if (currentPhase.value === 'review') currentPhase.value = 'configure';
}

function selectPhase(id: string): void {
  const nextIndex = PHASES.findIndex((phase) => phase.id === id);
  if (nextIndex < 0 || nextIndex >= phaseIndex.value || currentPhase.value === 'execute') return;
  currentPhase.value = id as PhaseId;
}

async function startInstall(): Promise<void> {
  const request: InstallRequest = { ...draftStore.draft };
  currentPhase.value = 'execute';
  await installStore.begin(request);
}

function advanceConfiguration(): void {
  if (!sectionReady(activeConfigSection.value)) return;
  const index = CONFIG_SECTIONS.findIndex((section) => section.id === activeConfigSection.value);
  const next = CONFIG_SECTIONS[index + 1];
  if (next) activeConfigSection.value = next.id;
  else void reviewConfiguration();
}

function runPrimaryAction(): void {
  if (currentPhase.value === 'license') continueFromLicense();
  else if (currentPhase.value === 'configure') advanceConfiguration();
  else if (currentPhase.value === 'review') void startInstall();
}

function onKeydownEnter(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing || currentPhase.value === 'execute') return;
  const active = document.activeElement as HTMLElement | null;
  if (!active || !contentRef.value) return;
  const tag = active.tagName;
  if (tag === 'BUTTON' || tag === 'A') return;

  const isInputLike = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (isInputLike) {
    const input = active as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'hidden' || input.disabled) return;
  }

  const focusables = Array.from(
    contentRef.value.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input:not([type="checkbox"]):not([type="hidden"]), select',
    ),
  ).filter((element) => !element.disabled && element.offsetParent !== null);
  const index = focusables.indexOf(active as HTMLInputElement | HTMLSelectElement);
  if (index >= 0 && index < focusables.length - 1) {
    event.preventDefault();
    focusables[index + 1].focus();
    return;
  }
  event.preventDefault();
  runPrimaryAction();
}

watch(
  () => installStore.cancelRequested,
  (requested) => {
    if (!requested) return;
    installStore.cancelRequested = false;
    confirmingCancel.value = true;
  },
);

onMounted(() => {
  if (installStore.activeTaskId || installStore.progress) currentPhase.value = 'execute';
  window.addEventListener('keydown', onKeydownEnter);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydownEnter);
});

function cancelInstall(): void {
  confirmingCancel.value = true;
}

const cancelTitle = computed(() => (installStore.activeTaskId ? '确认取消安装' : '放弃本次配置？'));

const cancelMessage = computed(() =>
  installStore.activeTaskId
    ? '取消将中止当前安装并清理已下载的临时文件，此操作不可恢复。'
    : '尚未开始安装，返回后本次填写的配置将被清空。',
);

async function confirmCancel(): Promise<void> {
  confirmingCancel.value = false;
  if (installStore.activeTaskId) cancelling.value = true;
  try {
    await installStore.cancel();
    draftStore.reset();
  } finally {
    cancelling.value = false;
  }
  emit('close');
}

function goToInstances(): void {
  emit('complete');
}
</script>

<template>
  <div class="wizard">
    <InstallerTaskShell
      :title="shellTitle"
      :subtitle="shellSubtitle"
      :icon="shellIcon"
      :phases="PHASES"
      :active-phase="currentPhase"
      :navigable="currentPhase !== 'execute'"
      :show-footer="currentPhase !== 'execute'"
      @select-phase="selectPhase"
    >
      <template #badge>
        <span class="task-badge" :class="phaseBadgeClass">{{ phaseBadge }}</span>
      </template>

      <div ref="contentRef" class="wizard__content">
        <InstallLicenseStep v-if="currentPhase === 'license'" v-model:agreed="licenseAgreed" />

        <section v-else-if="currentPhase === 'configure'" class="configuration-screen">
          <div class="configuration-screen__intro">
            <div>
              <h2>完成实例配置</h2>
              <p>一次只展开一组，减少干扰；右侧状态会提示还缺哪些信息。</p>
            </div>
            <span class="configuration-screen__progress">{{ configuredCount }} / 5</span>
          </div>

          <div class="config-sections">
            <article
              v-for="section in CONFIG_SECTIONS"
              :key="section.id"
              class="config-section"
              :class="{
                'config-section--open': activeConfigSection === section.id,
                'config-section--ready': sectionReady(section.id),
              }"
            >
              <button
                type="button"
                class="config-section__header state-layer"
                :aria-expanded="activeConfigSection === section.id"
                @click="activeConfigSection = section.id"
              >
                <span class="config-section__icon" aria-hidden="true">
                  <span class="msr" :class="{ 'msr--fill': sectionReady(section.id) }">
                    {{ sectionReady(section.id) ? 'check_circle' : section.icon }}
                  </span>
                </span>
                <span class="config-section__copy">
                  <span class="config-section__title">{{ section.title }}</span>
                  <span class="config-section__summary" :title="sectionSummary(section.id)">
                    {{ sectionSummary(section.id) }}
                  </span>
                </span>
                <span class="config-section__state">
                  {{ sectionReady(section.id) ? '已就绪' : section.description }}
                </span>
                <span class="msr config-section__chevron" aria-hidden="true">expand_more</span>
              </button>
              <div class="config-section__body-grid">
                <div class="config-section__body-clip">
                  <div class="config-section__body">
                    <component :is="section.component" />
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section v-else-if="currentPhase === 'review'" class="review-screen">
          <div class="review-screen__intro">
            <span class="review-screen__icon" aria-hidden="true">
              <span class="msr msr--fill">fact_check</span>
            </span>
            <div>
              <h2>准备安装</h2>
              <p>目标目录已通过空间和写入权限检查。</p>
            </div>
          </div>
          <InstallSummaryStep />
        </section>

        <InstallExecuteStep
          v-else
          :instance-name="draftStore.draft.instanceName"
          @cancel="cancelInstall"
          @finish="goToInstances"
        />
      </div>

      <template #leading-actions>
        <button
          v-if="currentPhase === 'license'"
          type="button"
          class="btn btn--text state-layer"
          @click="cancelInstall"
        >
          取消
        </button>
        <button v-else type="button" class="btn btn--text state-layer" @click="backOnePhase">
          <span class="msr" aria-hidden="true">arrow_back</span>
          返回
        </button>
      </template>

      <template #actions>
        <button
          v-if="currentPhase === 'license'"
          type="button"
          class="btn btn--filled state-layer"
          :disabled="!licenseAgreed"
          @click="continueFromLicense"
        >
          开始配置
          <span class="msr" aria-hidden="true">arrow_forward</span>
        </button>
        <button
          v-else-if="currentPhase === 'configure'"
          type="button"
          class="btn btn--filled state-layer"
          :disabled="draftStore.validatingTargetDir"
          @click="reviewConfiguration"
        >
          <span v-if="draftStore.validatingTargetDir" class="spinner spinner--small"></span>
          {{ draftStore.validatingTargetDir ? '正在检查目录' : '检查并继续' }}
          <span v-if="!draftStore.validatingTargetDir" class="msr" aria-hidden="true">
            arrow_forward
          </span>
        </button>
        <button
          v-else-if="currentPhase === 'review'"
          type="button"
          class="btn btn--filled state-layer"
          @click="startInstall"
        >
          <span class="msr" aria-hidden="true">rocket_launch</span>
          开始安装
        </button>
      </template>
    </InstallerTaskShell>

    <BaseDialog
      :open="confirmingCancel"
      :title="cancelTitle"
      :width="380"
      confirm-text="确定离开"
      cancel-text="继续当前任务"
      @close="confirmingCancel = false"
      @confirm="confirmCancel"
    >
      <p class="cancel-confirm__message">{{ cancelMessage }}</p>
    </BaseDialog>

    <BaseDialog
      :open="cancelling"
      :dismissible="false"
      :show-actions="false"
      title="正在取消安装"
      :width="360"
    >
      <div class="cancelling-dialog">
        <span class="spinner" aria-hidden="true"></span>
        <p class="cancelling-dialog__message">正在停止任务并清理临时文件，请稍候…</p>
      </div>
    </BaseDialog>
  </div>
</template>

<style scoped>
.wizard {
  height: 100%;
  min-height: 0;
}

.wizard__content {
  min-height: 100%;
}

.wizard__content :deep(.step-header) {
  display: none;
}

.task-badge {
  flex: none;
  padding: 5px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-medium);
}

.task-badge--success {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.task-badge--error {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.configuration-screen,
.review-screen {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.configuration-screen__intro,
.review-screen__intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px;
}

.configuration-screen__intro h2,
.configuration-screen__intro p,
.review-screen__intro h2,
.review-screen__intro p {
  margin: 0;
}

.configuration-screen__intro h2,
.review-screen__intro h2 {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-large);
}

.configuration-screen__intro p,
.review-screen__intro p {
  margin-top: 3px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.configuration-screen__progress {
  flex: none;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-title-medium);
}

.config-sections {
  display: grid;
  gap: 3px;
}

.config-section {
  overflow: hidden;
  border-radius: 7px;
  background: var(--md-sys-color-surface-container);
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.config-section:first-child {
  border-radius: 20px 20px 7px 7px;
}

.config-section:last-child {
  border-radius: 7px 7px 20px 20px;
}

.config-section--open {
  background: var(--md-sys-color-surface-container-high);
}

.config-section__header {
  width: 100%;
  min-height: 70px;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) minmax(110px, auto) 24px;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  text-align: left;
  cursor: pointer;
}

.config-section__icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.config-section--ready .config-section__icon {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.config-section__icon .msr {
  font-size: 22px;
}

.config-section__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.config-section__title {
  font: var(--md-sys-typescale-title-medium);
}

.config-section__summary,
.config-section__state {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.config-section__summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-section__state {
  text-align: right;
}

.config-section--ready .config-section__state {
  color: var(--md-sys-color-tertiary);
  font-weight: 600;
}

.config-section__chevron {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 22px;
  transition: transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

.config-section--open .config-section__chevron {
  transform: rotate(180deg);
}

.config-section__body-grid {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard),
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.config-section--open .config-section__body-grid {
  grid-template-rows: 1fr;
  opacity: 1;
}

.config-section__body-clip {
  min-height: 0;
  overflow: hidden;
}

.config-section__body {
  padding: 6px 18px 22px 70px;
}

.review-screen__intro {
  justify-content: flex-start;
  padding: 2px 4px 4px;
}

.review-screen__icon {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.cancel-confirm__message,
.cancelling-dialog__message {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
  line-height: 1.5;
}

.cancelling-dialog {
  display: flex;
  align-items: center;
  gap: 14px;
}

@media (prefers-reduced-motion: reduce) {
  .config-section__body-grid,
  .config-section__chevron {
    transition-duration: var(--md-sys-motion-duration-short2);
  }
}

@media (max-width: 700px) {
  .config-section__header {
    grid-template-columns: 42px minmax(0, 1fr) 24px;
  }

  .config-section__state {
    display: none;
  }

  .config-section__body {
    padding: 6px 14px 20px;
  }

  .configuration-screen__intro p {
    display: none;
  }
}
</style>
