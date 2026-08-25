<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import type { InstalledPlatform } from '@shared/domain/instance';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import { useWindowTitle } from '@/composables/use-window-title';
import StatusBadge from '@/components/StatusBadge.vue';
import BaseDialog from '@/components/BaseDialog.vue';

// 实例管理页：集中查看与修改实例配置，并提供打开目录、删除等文件系统操作。
const route = useRoute();
const router = useRouter();
const instancesStore = useInstancesStore();

const instanceId = computed(() => String(route.params.id ?? ''));
const instance = computed(() => instancesStore.byId(instanceId.value));

// 页面标题跟随实例名称与运行状态展示在窗口栏。
useWindowTitle({ title: () => instance.value?.name ?? '实例管理', subtitle: '实例管理' });

// 表单只承载可编辑配置字段，只读元数据（ID、时间戳等）直接来自仓库实例。
const name = ref('');
const mofoxDir = ref('');
const platformId = ref('');
const platformDir = ref('');
const platformVersion = ref('');
const autoStart = ref(false);

const platforms = ref<BotPlatformMetadata[]>([]);
const platformOptionsLoading = ref(false);
const saving = ref(false);
const toast = ref('');
const pendingRemove = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function formatDate(value: number | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function syncForm(): void {
  if (!instance.value) return;
  name.value = instance.value.name;
  mofoxDir.value = instance.value.mofoxInstallDir;
  platformId.value = instance.value.platform?.id ?? '';
  platformDir.value = instance.value.platform?.installDir ?? '';
  platformVersion.value = instance.value.platform?.version ?? '';
  autoStart.value = instance.value.autoStart;
}

watch(instance, () => syncForm(), { immediate: true });

function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 2600);
}

onMounted(async () => {
  await instancesStore.refresh();
  if (!instance.value) {
    void router.replace({ name: 'instances' });
    return;
  }
  syncForm();
  platformOptionsLoading.value = true;
  try {
    platforms.value = await mofoxApi.listBotPlatforms();
  } catch (error) {
    showToast(`平台列表加载失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    platformOptionsLoading.value = false;
  }
});

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer);
});

function onPlatformChange(event: Event): void {
  platformId.value = (event.target as HTMLSelectElement).value;
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

function openFolder(): void {
  void mofoxApi.openInstanceFolder(instanceId.value);
}

function openLogs(): void {
  void router.push({ name: 'instance-logs', params: { id: instanceId.value } });
}

function goBack(): void {
  router.back();
}

function requestRemove(): void {
  pendingRemove.value = true;
}

function cancelRemove(): void {
  pendingRemove.value = false;
}

async function confirmRemove(): Promise<void> {
  if (!instance.value) return;
  await instancesStore.remove(instance.value.id);
  pendingRemove.value = false;
  void router.replace({ name: 'instances' });
}

async function save(): Promise<void> {
  if (!instance.value || saving.value) return;
  if (!name.value.trim()) {
    showToast('实例名称不能为空');
    return;
  }
  saving.value = true;
  try {
    const platform: InstalledPlatform | null = platformId.value
      ? {
          id: platformId.value,
          installDir: platformDir.value,
          version: platformVersion.value || null,
        }
      : null;
    await instancesStore.update(instanceId.value, {
      name: name.value.trim(),
      mofoxInstallDir: mofoxDir.value,
      platform,
      autoStart: autoStart.value,
    });
    showToast('实例配置已保存');
  } catch (error) {
    showToast(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="manage-view">
    <!-- 页头：返回、实例名称与运行状态，右侧为日志、目录和删除等实例操作 -->
    <header class="manage-view__header">
      <button
        class="icon-btn state-layer"
        type="button"
        title="返回"
        aria-label="返回"
        @click="goBack"
      >
        <span class="msr" aria-hidden="true">arrow_back</span>
      </button>

      <div class="manage-view__title">
        <h1 class="manage-view__name">{{ instance?.name ?? '实例管理' }}</h1>
        <StatusBadge v-if="instance" :status="instance.status" />
      </div>

      <div class="manage-view__actions">
        <button class="btn btn--tonal state-layer" type="button" @click="openLogs">
          <span class="msr btn__icon" aria-hidden="true">terminal</span>
          查看日志
        </button>
        <button class="btn btn--tonal state-layer" type="button" @click="openFolder">
          <span class="msr btn__icon" aria-hidden="true">folder_open</span>
          打开文件夹
        </button>
        <button class="btn btn--danger state-layer" type="button" @click="requestRemove">
          <span class="msr btn__icon" aria-hidden="true">delete</span>
          删除
        </button>
      </div>
    </header>

    <div class="manage-view__body">
      <!-- 只读元数据：ID、状态、时间戳等由仓库实例直接提供 -->
      <section class="manage-card">
        <h2 class="manage-card__title">实例信息</h2>
        <dl v-if="instance" class="info-grid">
          <div class="info-grid__item">
            <dt>实例 ID</dt>
            <dd class="info-grid__value info-grid__value--mono">{{ instance.id }}</dd>
          </div>
          <div class="info-grid__item">
            <dt>运行状态</dt>
            <dd><StatusBadge :status="instance.status" /></dd>
          </div>
          <div class="info-grid__item">
            <dt>创建时间</dt>
            <dd>{{ formatDate(instance.createdAt) }}</dd>
          </div>
          <div class="info-grid__item">
            <dt>最后启动</dt>
            <dd>{{ formatDate(instance.lastStartedAt) }}</dd>
          </div>
        </dl>
        <p v-else class="manage-card__empty">实例不存在或已被删除。</p>
      </section>

      <!-- 可编辑配置：名称、目录与平台信息，提交后经管理 IPC 持久化 -->
      <section v-if="instance" class="manage-card">
        <h2 class="manage-card__title">实例配置</h2>
        <form class="config-form" @submit.prevent="save">
          <div class="form-group">
            <label class="field field--grow">
              <input v-model="name" class="field__input" type="text" placeholder=" " />
              <span class="field__label">实例名称</span>
            </label>
            <p class="field__support">显示在卡片与日志页上的实例名称。</p>
          </div>

          <div class="form-group">
            <div class="form-row">
              <label class="field field--grow">
                <input v-model="mofoxDir" class="field__input" type="text" placeholder=" " />
                <span class="field__label">MoFox 安装目录</span>
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
            <p class="field__support">Neo-MoFox 本体所在目录，运行时据此启动 main.py。</p>
          </div>

          <div class="form-group">
            <md-outlined-select
              class="platform-select"
              label="平台种类"
              :value="platformId"
              :disabled="platformOptionsLoading"
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
            <p v-if="platformId" class="field__support">
              修改平台种类后请同时核对下方平台安装目录，两者需保持一致。
            </p>
          </div>

          <div class="form-group">
            <div class="form-row">
              <label class="field field--grow">
                <input
                  v-model="platformDir"
                  class="field__input"
                  type="text"
                  placeholder=" "
                  :disabled="!platformId"
                />
                <span class="field__label">平台安装目录</span>
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
            <p class="field__support">平台适配器的安装目录；未选择平台时无需填写。</p>
          </div>

          <div class="form-group">
            <label class="field field--grow">
              <input
                v-model="platformVersion"
                class="field__input"
                type="text"
                placeholder=" "
                :disabled="!platformId"
              />
              <span class="field__label">平台版本</span>
            </label>
            <p class="field__support">平台发布版本号；手动导入且未知时可留空。</p>
          </div>

          <div class="config-form__row">
            <div class="settings-item">
              <span class="msr settings-item__icon" aria-hidden="true">power</span>
              <div class="settings-item__body">
                <span class="settings-item__label">启动器启动时自动运行</span>
              </div>
              <div
                class="md-switch"
                role="switch"
                :aria-checked="autoStart"
                :class="{ 'md-switch--checked': autoStart }"
                @click="autoStart = !autoStart"
              >
                <div class="md-switch__thumb"></div>
              </div>
            </div>

            <button class="btn btn--filled state-layer" type="submit" :disabled="saving">
              <span class="msr btn__icon" aria-hidden="true">save</span>
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <!-- 删除必须二次确认；删除前会先停止进程并清理目录与记录 -->
    <BaseDialog :open="pendingRemove" title="删除实例" :width="320" @close="cancelRemove">
      <p v-if="instance" class="remove-dialog__body">
        确定要删除实例「{{ instance.name }}」吗？此操作会删除其文件夹且无法撤销。
      </p>
      <template #actions>
        <button class="btn btn--text state-layer" type="button" @click="cancelRemove">取消</button>
        <button class="btn btn--error state-layer" type="button" @click="confirmRemove">
          删除
        </button>
      </template>
    </BaseDialog>

    <transition name="toast">
      <div v-if="toast" class="manage-view__toast" role="status">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.manage-view {
  height: 100%;
  overflow-y: auto;
  position: relative;
}

.manage-view__header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 32px 12px;
}

.manage-view__title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.manage-view__name {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manage-view__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.manage-view__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 0 32px 32px;
}

.manage-card {
  padding: 24px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.manage-card__title {
  margin: 0 0 16px;
  font: var(--md-sys-typescale-title-medium);
  color: var(--md-sys-color-on-surface);
}

.manage-card__empty {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin: 0;
}

.info-grid__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-grid__item dt {
  font: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.info-grid__item dd {
  margin: 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface);
}

.info-grid__value--mono {
  font-family: var(--md-ref-typeface-mono);
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
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

.config-form__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.settings-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.settings-item__icon {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 20px;
}

.settings-item__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.settings-item__label {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
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

.remove-dialog__body {
  margin: 0;
}

.manage-view__toast {
  position: fixed;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100% - 64px));
  padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  font: var(--md-sys-typescale-body-medium);
  box-shadow: var(--md-sys-elevation-level3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 30;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
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

@media (prefers-reduced-motion: reduce) {
  .md-switch,
  .md-switch__thumb,
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: translateX(-50%);
  }
}
</style>
