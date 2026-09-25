<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { Instance } from '@shared/domain/instance';
import StatusBadge from '@/components/StatusBadge.vue';
import { useInstancesStore } from '@/stores/instances';

// 信息查看面板：实例名称、运行状态与只读元数据集中展示；名称支持标题旁内联重命名。
const props = defineProps<{
  instance: Instance;
}>();

const emit = defineEmits<{
  back: [];
  toast: [message: string];
}>();

const instancesStore = useInstancesStore();

const MAX_NAME_LENGTH = 32;

const editingName = ref(false);
const draftName = ref('');
const nameError = ref('');
const savingName = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);

async function startRename(): Promise<void> {
  draftName.value = props.instance.name;
  nameError.value = '';
  editingName.value = true;
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
}

function cancelRename(): void {
  if (savingName.value) return;
  editingName.value = false;
  nameError.value = '';
}

function onDraftNameInput(): void {
  nameError.value = '';
}

async function confirmRename(): Promise<void> {
  if (savingName.value) return;
  const name = draftName.value.trim();
  if (!name) {
    nameError.value = '实例名称不能为空';
    return;
  }
  if (name.length > MAX_NAME_LENGTH) {
    nameError.value = '实例名称不能超过 32 个字符';
    return;
  }
  // 与原名称相同视为放弃编辑，不发起请求。
  if (name === props.instance.name) {
    editingName.value = false;
    nameError.value = '';
    return;
  }
  savingName.value = true;
  try {
    await instancesStore.update(props.instance.id, { name });
    editingName.value = false;
    nameError.value = '';
    emit('toast', '实例名称已更新');
  } catch (error) {
    nameError.value = error instanceof Error ? error.message : String(error);
  } finally {
    savingName.value = false;
  }
}

function formatDate(value: number | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <section class="manage-group">
    <div class="manage-info__head">
      <button
        class="icon-btn state-layer"
        type="button"
        title="返回"
        aria-label="返回"
        @click="emit('back')"
      >
        <span class="msr" aria-hidden="true">arrow_back</span>
      </button>
      <div v-if="!editingName" class="manage-info__title">
        <h2 class="manage-info__name">{{ instance.name }}</h2>
        <StatusBadge :status="instance.status" />
        <button
          class="icon-btn state-layer manage-info__rename-trigger"
          type="button"
          title="重命名"
          aria-label="重命名实例"
          @click="startRename"
        >
          <span class="msr" aria-hidden="true">edit</span>
        </button>
      </div>
      <div v-else class="manage-info__rename">
        <div class="manage-info__rename-row">
          <label class="field manage-info__rename-field" :class="{ 'field--error': nameError }">
            <input
              ref="nameInput"
              v-model="draftName"
              class="field__input"
              type="text"
              maxlength="32"
              placeholder=" "
              :disabled="savingName"
              @input="onDraftNameInput"
              @keydown.enter.prevent="confirmRename"
              @keydown.esc.prevent="cancelRename"
            />
            <span class="field__label">实例名称</span>
          </label>
          <button
            class="icon-btn state-layer"
            type="button"
            title="保存"
            aria-label="保存名称"
            :disabled="savingName"
            @click="confirmRename"
          >
            <span class="msr" aria-hidden="true">check</span>
          </button>
          <button
            class="icon-btn state-layer"
            type="button"
            title="取消"
            aria-label="取消重命名"
            :disabled="savingName"
            @click="cancelRename"
          >
            <span class="msr" aria-hidden="true">close</span>
          </button>
        </div>
        <Transition name="field-error" mode="out-in">
          <p
            v-if="nameError"
            class="field__support field__support--error manage-info__rename-error"
          >
            {{ nameError }}
          </p>
        </Transition>
      </div>
    </div>

    <!-- 选项行竖直排列，与设置页 settings-group__body 同构。 -->
    <div class="manage-group__body">
      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">fingerprint</span>
        <div class="settings-item__body">
          <span class="settings-item__label">实例 ID</span>
          <span class="settings-item__desc settings-item__desc--mono">{{ instance.id }}</span>
        </div>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">monitor_heart</span>
        <div class="settings-item__body">
          <span class="settings-item__label">运行状态</span>
        </div>
        <StatusBadge :status="instance.status" />
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">event</span>
        <div class="settings-item__body">
          <span class="settings-item__label">创建时间</span>
          <span class="settings-item__desc">{{ formatDate(instance.createdAt) }}</span>
        </div>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">schedule</span>
        <div class="settings-item__body">
          <span class="settings-item__label">最后启动</span>
          <span class="settings-item__desc">{{ formatDate(instance.lastStartedAt) }}</span>
        </div>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">folder</span>
        <div class="settings-item__body">
          <span class="settings-item__label">MoFox 安装目录</span>
          <span class="settings-item__desc settings-item__desc--mono">{{
            instance.mofoxInstallDir || '—'
          }}</span>
        </div>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">science</span>
        <div class="settings-item__body">
          <span class="settings-item__label">虚拟环境目录</span>
          <span class="settings-item__desc settings-item__desc--mono">{{
            instance.venvDir || '—'
          }}</span>
        </div>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">smart_toy</span>
        <div class="settings-item__body">
          <span class="settings-item__label">平台种类</span>
          <span class="settings-item__desc">{{ instance.platform?.id ?? '未安装' }}</span>
        </div>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">folder_open</span>
        <div class="settings-item__body">
          <span class="settings-item__label">平台安装目录</span>
          <span class="settings-item__desc settings-item__desc--mono">{{
            instance.platform?.installDir || '—'
          }}</span>
        </div>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">tag</span>
        <div class="settings-item__body">
          <span class="settings-item__label">平台版本</span>
          <span class="settings-item__desc">{{ instance.platform?.version || '—' }}</span>
        </div>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">power</span>
        <div class="settings-item__body">
          <span class="settings-item__label">启动时自动运行</span>
        </div>
        <span class="info-item__value">{{ instance.autoStart ? '是' : '否' }}</span>
      </div>

      <div class="settings-item">
        <span class="msr settings-item__icon" aria-hidden="true">favorite</span>
        <div class="settings-item__body">
          <span class="settings-item__label">已收藏</span>
        </div>
        <span class="info-item__value">{{ instance.extra?.isLike === true ? '是' : '否' }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.manage-group {
  width: 100%;
  max-width: 824px;
  box-sizing: border-box;
  margin: 0 auto;
  overflow: hidden;
  border: 0;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-low);
  box-shadow: none;
}

.manage-info__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--app-glass-border);
}

.manage-info__title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.manage-info__name {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manage-info__rename-trigger {
  flex: none;
}

/* 标题行内联重命名：复用全局 field 组件，标签底色需与卡片头同色才能形成镂空效果。 */
.manage-info__rename {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.manage-info__rename-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.manage-info__rename-field {
  --field-label-background: var(--md-sys-color-surface-container-low);

  flex: 0 1 auto;
  width: min(360px, 100%);
  min-width: 0;
}

.manage-info__rename-row .icon-btn {
  flex: none;
}

.manage-info__rename-row .icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.manage-info__rename-error {
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

/* 选项行竖直排列：布局与设置页 settings-group__body 同构。 */
.manage-group__body {
  display: grid;
  gap: 3px;
  padding: 12px 10px 10px;
}

.manage-group__body > :first-child {
  border-radius: 18px 18px 7px 7px;
}

.manage-group__body > :last-child {
  border-radius: 7px 7px 18px 18px;
}

.manage-group__body > :only-child {
  border-radius: 18px;
}

.settings-item {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  min-height: var(--app-density-row-min-height);
  padding: var(--app-density-row-padding-block) 18px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 88%, transparent);
}

.settings-item__icon {
  flex: none;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 24px;
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
  overflow-wrap: anywhere;
}

.settings-item__desc--mono {
  font-family: var(--md-ref-typeface-mono);
}

/* 短值（是/否）作为行尾元素展示，位置对齐设置页的开关控件。 */
.info-item__value {
  flex: none;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
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
