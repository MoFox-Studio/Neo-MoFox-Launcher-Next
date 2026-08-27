<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import type { Instance, InstalledPlatform } from '@shared/domain/instance';
import { mofoxApi } from '@/services/mofox-api';
import { useInstancesStore } from '@/stores/instances';
import BaseDialog from '@/components/BaseDialog.vue';

// 更多面板：文件系统操作、自动启动开关与实例信息修改入口。
const props = defineProps<{
  instance: Instance;
  platforms: BotPlatformMetadata[];
}>();

const emit = defineEmits<{
  toast: [message: string];
  deleted: [];
}>();

const instancesStore = useInstancesStore();

const editOpen = ref(false);
const mofoxDir = ref('');
const platformId = ref('');
const platformDir = ref('');
const autoStart = ref(false);
const saving = ref(false);
const validating = ref(false);
const pendingRemove = ref(false);

const mofoxDirError = ref('');
const platformDirError = ref('');
const checkingMofoxDir = ref(false);
const checkingPlatformDir = ref(false);

const showMofoxDirError = computed(() => mofoxDirError.value !== '');
const showPlatformDirError = computed(() => platformDirError.value !== '');

// 平台选项与选中值必须在同一次渲染同时就绪，否则 Material 下拉框不会展示已选值。
const platformSelectKey = computed(() => 'ready');

const platformLabel = computed(() => {
  const id = platformId.value;
  if (!id) return '未安装';
  return props.platforms.find((p) => p.id === id)?.name ?? id;
});

function syncForm(): void {
  mofoxDir.value = props.instance.mofoxInstallDir;
  platformId.value = props.instance.platform?.id ?? '';
  platformDir.value = props.instance.platform?.installDir ?? '';
  autoStart.value = props.instance.autoStart;
}

function openEditDialog(): void {
  syncForm();
  mofoxDirError.value = '';
  platformDirError.value = '';
  editOpen.value = true;
}

function closeEditDialog(): void {
  editOpen.value = false;
}

function onPlatformChange(event: Event): void {
  platformId.value = (event.target as HTMLSelectElement).value;
  // 平台种类切换后旧平台路径不再有效，必须清空等待用户重新指定。
  platformDir.value = '';
  platformDirError.value = '';
}

function onMofoxDirFocus(): void {
  mofoxDirError.value = '';
}

function onPlatformDirFocus(): void {
  platformDirError.value = '';
}

async function validateMofoxDir(): Promise<boolean> {
  const value = mofoxDir.value.trim();
  if (!value) {
    mofoxDirError.value = '主程序路径不能为空';
    return false;
  }
  mofoxDirError.value = '';
  checkingMofoxDir.value = true;
  try {
    const check = await mofoxApi.inspectImportPath(value);
    if (!check.absolute) mofoxDirError.value = '请输入绝对路径';
    else if (!check.exists) mofoxDirError.value = '目录不存在';
    else if (!check.isDirectory) mofoxDirError.value = '必须是目录';
    else if (!check.mainPyExists)
      mofoxDirError.value = '不是有效的 Neo-MoFox 安装目录（缺少 main.py）';
  } catch {
    mofoxDirError.value = '目录校验失败，请稍后重试';
  } finally {
    checkingMofoxDir.value = false;
  }
  return mofoxDirError.value === '';
}

async function validatePlatformDir(): Promise<boolean> {
  if (!platformId.value) return true;
  const value = platformDir.value.trim();
  if (!value) {
    platformDirError.value = '平台安装目录不能为空';
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

async function browseDirectory(target: 'mofox' | 'platform'): Promise<void> {
  const defaultPath =
    target === 'mofox' ? mofoxDir.value || undefined : platformDir.value || undefined;
  const picked = await mofoxApi.pickDirectory({
    title: target === 'mofox' ? '选择 MoFox 安装目录' : '选择平台安装目录',
    defaultPath,
  });
  if (!picked) return;
  if (target === 'mofox') mofoxDir.value = picked;
  else platformDir.value = picked;
}

async function openFolder(): Promise<void> {
  await mofoxApi.openInstanceFolder(props.instance.id);
}

async function toggleAutoStart(): Promise<void> {
  const next = !autoStart.value;
  autoStart.value = next;
  try {
    await instancesStore.update(props.instance.id, { autoStart: next });
    emit('toast', next ? '已开启自动运行' : '已关闭自动运行');
  } catch (error) {
    autoStart.value = !next;
    emit('toast', `保存失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requestRemove(): void {
  pendingRemove.value = true;
}

function cancelRemove(): void {
  pendingRemove.value = false;
}

async function confirmRemove(): Promise<void> {
  await instancesStore.remove(props.instance.id);
  pendingRemove.value = false;
  emit('deleted');
}

async function save(): Promise<void> {
  if (saving.value || validating.value) return;
  validating.value = true;
  try {
    const mofoxValid = await validateMofoxDir();
    const platformValid = await validatePlatformDir();
    if (!mofoxValid || !platformValid) return;
  } finally {
    validating.value = false;
  }
  saving.value = true;
  try {
    const currentPlatform = props.instance.platform;
    const platformChanged = platformId.value !== (currentPlatform?.id ?? '');
    // 平台种类变化时旧版本号不再可信，置空；仅改路径时保留原版本。
    const platform: InstalledPlatform | null = platformId.value
      ? {
          id: platformId.value,
          installDir: platformDir.value,
          version: platformChanged ? null : (currentPlatform?.version ?? null),
        }
      : null;
    await instancesStore.update(props.instance.id, {
      mofoxInstallDir: mofoxDir.value,
      platform,
    });
    editOpen.value = false;
    syncForm();
    emit('toast', '实例配置已保存');
  } catch (error) {
    emit('toast', `保存失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    saving.value = false;
  }
}

// 弹窗打开时保留用户的编辑内容，实例变化只在弹窗关闭时回填。
watch(
  () => props.instance,
  () => {
    if (editOpen.value) return;
    syncForm();
  },
);
</script>

<template>
  <section class="manage-group">
    <div class="manage-group__head">
      <h2 class="manage-group__title">更多</h2>
    </div>
    <div class="manage-group__body">
      <div class="action-list">
        <div class="settings-item">
          <span class="msr settings-item__icon" aria-hidden="true">tune</span>
          <div class="settings-item__body">
            <span class="settings-item__label">修改实例信息</span>
            <span class="settings-item__desc">修改平台种类与安装路径</span>
          </div>
          <button class="btn btn--tonal state-layer" type="button" @click="openEditDialog">
            修改
          </button>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-item">
          <span class="msr settings-item__icon" aria-hidden="true">folder_open</span>
          <div class="settings-item__body">
            <span class="settings-item__label">打开文件夹</span>
            <span class="settings-item__desc">在系统文件管理器中查看 MoFox 安装目录</span>
          </div>
          <button class="btn btn--tonal state-layer" type="button" @click="openFolder">
            打开文件夹
          </button>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-item">
          <span class="msr settings-item__icon settings-item__icon--danger" aria-hidden="true"
            >delete</span
          >
          <div class="settings-item__body">
            <span class="settings-item__label">删除实例</span>
            <span class="settings-item__desc">停止进程并删除实例文件夹，此操作无法撤销</span>
          </div>
          <button class="btn btn--danger state-layer" type="button" @click="requestRemove">
            删除
          </button>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-item">
          <span class="msr settings-item__icon" aria-hidden="true">power</span>
          <div class="settings-item__body">
            <span class="settings-item__label">启动器启动时自动运行</span>
            <span class="settings-item__desc">应用启动后自动启动此实例</span>
          </div>
          <div
            class="md-switch"
            role="switch"
            :aria-checked="autoStart"
            :class="{ 'md-switch--checked': autoStart }"
            @click="toggleAutoStart"
          >
            <div class="md-switch__thumb"></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- 修改实例信息弹窗：只允许修改平台种类与安装路径 -->
  <BaseDialog
    :open="editOpen"
    title="修改实例信息"
    :width="480"
    :dismissible="!saving && !validating"
    @close="closeEditDialog"
  >
    <form class="edit-form" @submit.prevent="save">
      <div class="form-group">
        <md-outlined-select
          :key="platformSelectKey"
          class="platform-select"
          label="平台种类"
          :value="platformId"
          @change="onPlatformChange"
        >
          <!-- Material Web Components 使用原生具名插槽，而不是 Vue 模板插槽。 -->
          <!-- eslint-disable vue/no-deprecated-slot-attribute -->
          <md-select-option value="">
            <div slot="headline">不安装平台</div>
          </md-select-option>
          <md-select-option v-for="p in platforms" :key="p.id" :value="p.id">
            <div slot="headline">{{ p.name }}</div>
          </md-select-option>
          <!-- eslint-enable vue/no-deprecated-slot-attribute -->
        </md-outlined-select>
        <p class="field__support">
          当前平台：{{ platformLabel }}。切换平台种类后必须重新指定平台安装目录。
        </p>
      </div>

      <div class="form-group">
        <div class="form-row">
          <label class="field field--grow" :class="{ 'field--error': showMofoxDirError }">
            <input
              v-model="mofoxDir"
              class="field__input"
              type="text"
              placeholder=" "
              @focus="onMofoxDirFocus"
            />
            <span class="field__label">主程序路径</span>
          </label>
          <button
            class="icon-btn icon-btn--browse state-layer"
            type="button"
            title="浏览目录"
            aria-label="浏览 MoFox 安装目录"
            @click="browseDirectory('mofox')"
          >
            <span class="msr" aria-hidden="true">folder_open</span>
          </button>
        </div>
        <Transition name="field-error" mode="out-in">
          <p v-if="showMofoxDirError" key="error" class="field__support field__support--error">
            {{ mofoxDirError }}
          </p>
          <p v-else key="hint" class="field__support">
            <template v-if="checkingMofoxDir">正在校验目录…</template>
            <template v-else>Neo-MoFox 本体所在目录，运行时据此启动 main.py。</template>
          </p>
        </Transition>
      </div>

      <div class="form-group">
        <div class="form-row">
          <label class="field field--grow" :class="{ 'field--error': showPlatformDirError }">
            <input
              v-model="platformDir"
              class="field__input"
              type="text"
              placeholder=" "
              :disabled="!platformId"
              @focus="onPlatformDirFocus"
            />
            <span class="field__label">平台路径</span>
          </label>
          <button
            class="icon-btn icon-btn--browse state-layer"
            type="button"
            title="浏览目录"
            aria-label="浏览平台安装目录"
            :disabled="!platformId"
            @click="browseDirectory('platform')"
          >
            <span class="msr" aria-hidden="true">folder_open</span>
          </button>
        </div>
        <Transition name="field-error" mode="out-in">
          <p v-if="showPlatformDirError" key="error" class="field__support field__support--error">
            {{ platformDirError }}
          </p>
          <p v-else key="hint" class="field__support">
            <template v-if="checkingPlatformDir">正在校验目录…</template>
            <template v-else>平台适配器的安装目录；未选择平台时无需填写。</template>
          </p>
        </Transition>
      </div>
    </form>

    <template #actions>
      <button
        class="btn btn--text state-layer"
        type="button"
        :disabled="saving || validating"
        @click="closeEditDialog"
      >
        取消
      </button>
      <button
        class="btn btn--filled state-layer"
        type="button"
        :disabled="saving || validating"
        @click="save"
      >
        <span v-if="!saving && !validating" class="msr btn__icon" aria-hidden="true">save</span>
        {{ validating ? '正在校验…' : saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </BaseDialog>

  <!-- 删除必须二次确认；删除前会先停止进程并清理目录与记录 -->
  <BaseDialog :open="pendingRemove" title="删除实例" :width="320" @close="cancelRemove">
    <p class="remove-dialog__body">
      确定要删除实例「{{ instance.name }}」吗？此操作会删除其文件夹且无法撤销。
    </p>
    <template #actions>
      <button class="btn btn--text state-layer" type="button" @click="cancelRemove">取消</button>
      <button class="btn btn--error state-layer" type="button" @click="confirmRemove">删除</button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.manage-group {
  width: 100%;
  max-width: 824px;
  box-sizing: border-box;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--app-glass-border);
  border-radius: 20px;
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.manage-group__head {
  display: flex;
  align-items: center;
  padding: 16px 24px 0;
}

.manage-group__title {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
}

.manage-group__body {
  padding: 24px;
}

.action-list {
  display: flex;
  flex-direction: column;
}

.settings-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 0;
}

.settings-item__icon {
  flex: none;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 20px;
}

.settings-item__icon--danger {
  color: var(--md-sys-color-error);
}

.settings-item__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-item__label {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
}

.settings-item__desc {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.settings-divider {
  height: 1px;
  background: var(--md-sys-color-outline-variant);
}

.md-switch {
  position: relative;
  width: 52px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  border: 2px solid var(--md-sys-color-outline);
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
  flex-shrink: 0;
}

.md-switch__thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-outline);
  transform: translateY(-50%);
  transition:
    left var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch--checked {
  background: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.md-switch--checked .md-switch__thumb {
  left: 24px;
  background: var(--md-sys-color-on-primary);
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.edit-form .field__support {
  margin: 4px 0 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.platform-select {
  width: 100%;
}

.icon-btn--browse {
  flex: none;
  margin-top: 8px;
  width: 40px;
  height: 40px;
}

.remove-dialog__body {
  margin: 0;
}

.field-error-enter-active,
.field-error-leave-active {
  transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized);
}

.field-error-enter-from,
.field-error-leave-to {
  opacity: 0;
}

.field-error-enter-active.field__support--error {
  animation: field-error-shake var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized);
}

@keyframes field-error-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-4px);
  }
  50% {
    transform: translateX(4px);
  }
  75% {
    transform: translateX(-2px);
  }
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.btn__icon {
  font-size: 18px;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--tonal {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.btn--danger {
  background: color-mix(in srgb, var(--md-sys-color-error) 12%, transparent);
  color: var(--md-sys-color-error);
}

.btn--text {
  padding: 0 12px;
  background: transparent;
  color: var(--md-sys-color-primary);
}

.btn--error {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: grid;
  place-items: center;
  cursor: pointer;
}
</style>
