<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useOobeStore } from '@/stores/oobe';
import { MofoxError } from '@shared/domain/error';
import type { OobeDependencyStatus } from '@shared/domain/oobe';
import ErrorDialog from '@/components/ErrorDialog.vue';
import BaseDialog from '@/components/BaseDialog.vue';

const oobe = useOobeStore();
const emit = defineEmits<{ (e: 'next'): void; (e: 'back'): void; (e: 'skip'): void }>();

// 依赖安装完成后，部分组件（如新加入 PATH 的可执行文件）需要重启系统才能生效。
// 弹窗以不可关闭的方式提示用户手动重启，避免用户误以为可直接继续。
const showRestartDialog = ref(false);

// 仅 Linux 的系统包安装需要 sudo；macOS 与 Windows 不展示密码表单。
const needsSudo = typeof navigator !== 'undefined' && /Linux/i.test(navigator.userAgent);
const password = ref('');
const verifying = ref(false);
const sudoVerified = ref(false);
const sudoErrorMessage = ref<string | null>(null);
const awaitingSudo = ref(false);
const checking = ref(true);
const inspectionError = ref<string | null>(null);
const installationSkipped = ref(false);
const showErrorDialog = ref(false);

const hasMissing = computed(() => oobe.dependencies.some((dependency) => dependency.status === 'pending'));
const hasFailure = computed(() => oobe.dependencies.some((dependency) => dependency.status === 'failed'));
const allDone = computed(
  () =>
    oobe.dependencies.length > 0 &&
    oobe.dependencies.every(
      (dependency) => dependency.status === 'installed' || dependency.status === 'skipped',
    ),
);
const canContinue = computed(() => allDone.value || installationSkipped.value);
const canSubmitPassword = computed(() => password.value.length > 0 && !verifying.value);
const errorLogText = computed(() => oobe.logs.join('\n'));

watch(hasFailure, (failed) => {
  if (failed) showErrorDialog.value = true;
});

function statusIcon(status: OobeDependencyStatus['status']): string {
  switch (status) {
    case 'installed':
    case 'skipped':
      return 'check_circle';
    case 'failed':
      return 'error';
    case 'installing':
      return 'progress_activity';
    default:
      return 'pending';
  }
}

function statusLabel(status: OobeDependencyStatus['status']): string {
  switch (status) {
    case 'installed':
      return '已安装';
    case 'skipped':
      return '已存在';
    case 'failed':
      return '失败';
    case 'installing':
      return '安装中';
    default:
      return '未安装';
  }
}

function describeError(error: unknown): string {
  if (error instanceof MofoxError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}

async function inspectDependencies(): Promise<void> {
  checking.value = true;
  inspectionError.value = null;
  installationSkipped.value = false;
  try {
    await oobe.inspectDependencies();
  } catch (error) {
    inspectionError.value = describeError(error);
  } finally {
    checking.value = false;
  }
}

async function startInstall(): Promise<void> {
  try {
    await oobe.installDependencies();
  } catch {
    // 服务层会将错误和日志同步至仓库，由错误弹窗呈现。
  }
}

function requestInstall(): void {
  installationSkipped.value = false;
  if (needsSudo && !sudoVerified.value) {
    awaitingSudo.value = true;
    return;
  }
  void startInstall();
}

async function submitPassword(): Promise<void> {
  if (!canSubmitPassword.value) return;
  verifying.value = true;
  sudoErrorMessage.value = null;
  try {
    if (!(await oobe.verifySudo(password.value))) {
      sudoErrorMessage.value = '密码错误或 sudo 不可用，请重新输入。';
      return;
    }
    sudoVerified.value = true;
    awaitingSudo.value = false;
    password.value = '';
    await startInstall();
  } catch (error) {
    sudoErrorMessage.value = describeError(error);
  } finally {
    verifying.value = false;
  }
}

function skipInstallation(): void {
  installationSkipped.value = true;
  emit('skip');
}

/**
 * 点击“继续”时不直接进入下一步，而是先弹出重启提示。
 *
 * 仅在实际执行过安装（未跳过且无失败）时展示弹窗；若用户跳过了安装，
 * 则无需重启，直接放行。
 */
function requestContinue(): void {
  if (installationSkipped.value || !oobe.dependencies.some((d) => d.status === 'installed')) {
    emit('next');
    return;
  }
  showRestartDialog.value = true;
}

/** 用户确认后，关闭弹窗并进入下一步。 */
function confirmRestarted(): void {
  showRestartDialog.value = false;
  emit('next');
}

async function retryInstall(): Promise<void> {
  oobe.reset();
  sudoVerified.value = false;
  awaitingSudo.value = false;
  password.value = '';
  await inspectDependencies();
}

onMounted(() => {
  void inspectDependencies();
});

onUnmounted(() => {
  oobe.dispose();
});
</script>

<template>
  <section class="oobe-step">
    <h2 class="oobe__step-title">依赖安装</h2>
    <p class="oobe__step-desc">检查 Neo-MoFox 运行所需的工具，并由你决定是否安装缺失项。</p>

    <div v-if="checking" class="dep-list__empty">
      <span class="spinner" aria-hidden="true"></span>
      <span>正在检查已安装的工具…</span>
    </div>

    <template v-else>
      <div v-if="inspectionError" class="inspection-error">
        <span class="msr" aria-hidden="true">error</span>
        <span>{{ inspectionError }}</span>
        <button type="button" class="btn btn--text state-layer" @click="inspectDependencies">重新检查</button>
      </div>

      <ul v-else class="dep-list">
        <li
v-for="dep in oobe.dependencies" :key="dep.id" class="dep-list__item"
          :class="`dep-list__item--${dep.status}`">
          <span
class="msr dep-list__icon" :class="{ 'dep-list__icon--spin': dep.status === 'installing' }"
            aria-hidden="true">
            {{ statusIcon(dep.status) }}
          </span>
          <div class="dep-list__body">
            <span class="dep-list__name">{{ dep.displayName }}</span>
            <span v-if="dep.message" class="dep-list__message">{{ dep.message }}</span>
          </div>
          <span class="dep-list__status" :class="`dep-list__status--${dep.status}`">
            {{ statusLabel(dep.status) }}
          </span>
        </li>
      </ul>

      <div v-if="hasMissing && !oobe.installing && !hasFailure" class="install-choice">
        <span class="msr install-choice__icon" aria-hidden="true">download</span>
        <div>
          <p class="install-choice__title">发现缺失依赖</p>
          <p class="install-choice__desc">可现在安装，也可稍后自行配置后继续使用。</p>
        </div>
        <div class="install-choice__actions">
          <button type="button" class="btn btn--text state-layer" @click="skipInstallation">暂不安装</button>
          <button type="button" class="btn btn--filled state-layer" @click="requestInstall">安装缺失依赖</button>
        </div>
      </div>

      <div v-if="awaitingSudo && !sudoVerified" class="sudo-block">
        <p class="sudo-block__hint">
          Linux 安装系统依赖需要 sudo 权限。密码只在本次安装期间保留于主进程内存，完成后会立即清除，不会写入磁盘。
        </p>
        <label class="field">
          <input
v-model="password" class="field__input" type="password" placeholder=" " autocomplete="current-password"
            @keyup.enter="submitPassword" />
          <span class="field__label">sudo 密码</span>
        </label>
        <p v-if="sudoErrorMessage" class="field__support field__support--error">{{ sudoErrorMessage }}</p>
        <div class="sudo-actions">
          <button
type="button" class="btn btn--text state-layer" :disabled="verifying"
            @click="awaitingSudo = false">
取消
</button>
          <button
type="button" class="btn btn--filled state-layer" :disabled="!canSubmitPassword"
            @click="submitPassword">
            <span v-if="verifying" class="spinner spinner--small" aria-hidden="true"></span>
            验证并安装
          </button>
        </div>
      </div>

      <p v-if="oobe.currentMessage && oobe.installing" class="dep-current">{{ oobe.currentMessage }}</p>

      <div class="dep-actions">
        <button
type="button" class="btn btn--text state-layer" :disabled="oobe.installing"
          @click="emit('back')">
上一步
</button>
        <button v-if="hasFailure" type="button" class="btn btn--text state-layer" @click="showErrorDialog = true">
          <span class="msr" aria-hidden="true">description</span>
          查看日志
        </button>
        <button
v-if="hasFailure" type="button" class="btn btn--filled state-layer" :disabled="oobe.installing"
          @click="retryInstall">
重新检查
</button>
        <button
v-else type="button" class="btn btn--filled state-layer" :disabled="!canContinue || oobe.installing"
          @click="requestContinue">
继续
</button>
      </div>
    </template>

    <ErrorDialog
:open="showErrorDialog" :description="oobe.installError ? describeError(oobe.installError) : '依赖安装失败'"
      :stack="errorLogText || undefined" title="依赖安装失败" @close="showErrorDialog = false" />

    <BaseDialog
:open="showRestartDialog" :dismissible="false" :show-actions="false" title="请重启电脑以完成安装"
      :width="440">
      <div class="restart-dialog">
        <span class="msr restart-dialog__icon" aria-hidden="true">restart_alt</span>
        <p class="restart-dialog__message">
          部分依赖（如新加入系统 PATH 的可执行文件）需要重启系统后才能生效。请保存当前工作并手动重启电脑，重启后再次打开启动器即可继续。
        </p>
      </div>
      <template #actions>
        <button type="button" class="btn btn--filled state-layer" @click="confirmRestarted">知道了</button>
      </template>
    </BaseDialog>
  </section>
</template>

<style scoped>
.dep-list {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dep-list__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 4px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.dep-list__icon {
  font-size: 20px;
  color: var(--md-sys-color-on-surface-variant);
}

.dep-list__icon--spin {
  animation: dep-spin 1.2s linear infinite;
}

.dep-list__item--installed .dep-list__icon,
.dep-list__item--skipped .dep-list__icon {
  color: var(--md-sys-color-tertiary);
}

.dep-list__item--failed .dep-list__icon {
  color: var(--md-sys-color-error);
}

.dep-list__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dep-list__name {
  font: var(--md-sys-typescale-body-large);
}

.dep-list__message {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.dep-list__status {
  font: var(--md-sys-typescale-label-medium);
  padding: 4px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}

.dep-list__status--installed,
.dep-list__status--skipped {
  color: var(--md-sys-color-tertiary);
  border-color: var(--md-sys-color-tertiary);
}

.dep-list__status--failed {
  color: var(--md-sys-color-error);
  border-color: var(--md-sys-color-error);
}

.dep-list__status--installing {
  color: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.dep-list__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 188px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.install-choice,
.sudo-block,
.inspection-error {
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-high);
}

.install-choice {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  padding: 16px;
  margin-bottom: 20px;
}

.install-choice__icon {
  color: var(--md-sys-color-primary);
  font-size: 22px;
}

.install-choice__title,
.install-choice__desc,
.sudo-block__hint {
  margin: 0;
}

.install-choice__title {
  font: var(--md-sys-typescale-title-small);
}

.install-choice__desc,
.sudo-block__hint {
  margin-top: 4px;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.5;
}

.install-choice__actions {
  grid-column: 2;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.sudo-block {
  padding: 16px;
  margin-bottom: 20px;
}

.field {
  position: relative;
  display: block;
  height: 56px;
  margin-top: 16px;
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
  background: var(--md-sys-color-surface-container-high);
  padding: 0 4px;
  pointer-events: none;
  transition: all var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.field__input:focus+.field__label,
.field__input:not(:placeholder-shown)+.field__label {
  top: 0;
  transform: translateY(-50%) scale(.85);
}

.field__input:focus+.field__label {
  color: var(--md-sys-color-primary);
}

.field__support {
  margin: 8px 0 0 16px;
  font: var(--md-sys-typescale-body-small);
}

.field__support--error {
  color: var(--md-sys-color-error);
}

.sudo-actions,
.dep-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.sudo-actions {
  margin-top: 16px;
}

.dep-current {
  margin: 0 0 16px;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.inspection-error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  margin-bottom: 20px;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-medium);
}

.inspection-error .btn {
  margin-left: auto;
}

.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  overflow: hidden;
}

.btn:disabled {
  opacity: .38;
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
}

.spinner {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--md-sys-color-primary) 25%, transparent);
  border-top-color: var(--md-sys-color-primary);
  animation: spinner-spin .8s linear infinite;
}

.spinner--small {
  width: 14px;
  height: 14px;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes dep-spin {
  to {
    transform: rotate(360deg);
  }
}

.restart-dialog {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.restart-dialog__icon {
  font-size: 24px;
  color: var(--md-sys-color-primary);
  flex-shrink: 0;
  margin-top: 2px;
}

.restart-dialog__message {
  margin: 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.5;
  word-break: break-word;
}
</style>
