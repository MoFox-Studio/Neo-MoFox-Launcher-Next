<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import PageHeader from '@/components/PageHeader.vue';
import { useSettingsStore } from '@/stores/settings';

// 手动添加实例：直接注册本机已有的 MoFox 安装目录，不下载任何组件。
const router = useRouter();
const instancesStore = useInstancesStore();
const settingsStore = useSettingsStore();

const displayName = ref('');
const mofoxInstallDir = ref('');
const platformId = ref('');
const platformDir = ref('');
const platformVersion = ref('');
const description = ref('');

const busy = ref(false);
const errorMessage = ref<string | null>(null);
const infoMessage = ref<string | null>(null);

onMounted(() => {
  instancesStore.refresh();
  void settingsStore.load();
});

async function chooseMofoxDir(): Promise<void> {
  const picked = await mofoxApi.pickDirectory({
    title: '选择 MoFox 安装目录',
    defaultPath: mofoxInstallDir.value || settingsStore.settings.defaultInstallDir || undefined,
  });
  if (!picked) return;
  mofoxInstallDir.value = picked;
}

async function choosePlatformDir(): Promise<void> {
  const picked = await mofoxApi.pickDirectory({
    title: '选择平台适配器目录',
    defaultPath: platformDir.value || undefined,
  });
  if (!picked) return;
  platformDir.value = picked;
}

async function submit(): Promise<void> {
  if (!mofoxInstallDir.value.trim()) {
    errorMessage.value = '请选择 MoFox 安装目录';
    return;
  }
  if (platformId.value || platformDir.value) {
    if (!platformId.value.trim() || !platformDir.value.trim()) {
      errorMessage.value = '已填写平台信息时，平台 ID 与目录都需要提供';
      return;
    }
  }
  busy.value = true;
  errorMessage.value = null;
  infoMessage.value = null;
  try {
    const result = await mofoxApi.manualAddInstance({
      displayName: displayName.value.trim() || undefined,
      mofoxInstallDir: mofoxInstallDir.value.trim(),
      platformId: platformId.value.trim() || undefined,
      platformDir: platformDir.value.trim() || undefined,
      platformVersion: platformVersion.value.trim() || undefined,
      description: description.value.trim() || undefined,
    });
    if (!result.success) {
      errorMessage.value = result.error ?? '添加失败';
      return;
    }
    infoMessage.value = result.channel
      ? `实例添加成功（频道：${result.channel}）`
      : '实例添加成功';
    await instancesStore.refresh();
    displayName.value = '';
    mofoxInstallDir.value = '';
    platformId.value = '';
    platformDir.value = '';
    platformVersion.value = '';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

function goInstances(): void {
  void router.push({ name: 'instances' });
}
</script>

<template>
  <div class="manual-add">
    <PageHeader title="手动添加实例" subtitle="注册本机已有的 MoFox 安装目录" />

    <div class="manual-add__body">
      <div class="card">
        <div class="form-row">
          <label class="form-label" for="manual-name">实例名称（可选）</label>
          <input
            id="manual-name"
            v-model="displayName"
            class="form-input"
            type="text"
            placeholder="留空时自动从目录名生成"
          />
        </div>

        <div class="form-row">
          <label class="form-label" for="manual-dir">MoFox 安装目录（必填）</label>
          <div class="path-picker">
            <input
              id="manual-dir"
              v-model="mofoxInstallDir"
              class="form-input"
              type="text"
              readonly
              placeholder="选择 MoFox 安装目录"
            />
            <button class="btn btn--tonal state-layer" type="button" @click="chooseMofoxDir">
              浏览…
            </button>
          </div>
        </div>

        <div class="manual-add__divider">平台适配器（可选）</div>

        <div class="form-row">
          <label class="form-label" for="manual-platform-id">平台 ID</label>
          <input
            id="manual-platform-id"
            v-model="platformId"
            class="form-input"
            type="text"
            placeholder="例如 napcat、snowluma"
          />
        </div>

        <div class="form-row">
          <label class="form-label" for="manual-platform-dir">平台目录</label>
          <div class="path-picker">
            <input
              id="manual-platform-dir"
              v-model="platformDir"
              class="form-input"
              type="text"
              readonly
              placeholder="选择平台适配器目录"
            />
            <button class="btn btn--tonal state-layer" type="button" @click="choosePlatformDir">
              浏览…
            </button>
          </div>
        </div>

        <div class="form-row">
          <label class="form-label" for="manual-platform-version">平台版本（可选）</label>
          <input
            id="manual-platform-version"
            v-model="platformVersion"
            class="form-input"
            type="text"
            placeholder="如 4.2.19"
          />
        </div>

        <p v-if="errorMessage" class="manual-add__error">{{ errorMessage }}</p>
        <p v-if="infoMessage" class="manual-add__success">{{ infoMessage }}</p>

        <div class="manual-add__actions">
          <button class="btn btn--text state-layer" type="button" @click="goInstances">
            查看实例
          </button>
          <button
            class="btn btn--filled state-layer"
            type="button"
            :disabled="busy || !mofoxInstallDir"
            @click="submit"
          >
            {{ busy ? '正在添加…' : '添加实例' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.manual-add {
  height: 100%;
  overflow-y: auto;
}

.manual-add__body {
  padding: 0 32px 32px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  box-sizing: border-box;
}

.path-picker {
  display: flex;
  gap: 8px;
}

.path-picker .form-input {
  flex: 1;
}

.manual-add__divider {
  margin-top: 4px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
}

.btn {
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
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

.btn--ghost {
  background: transparent;
  color: var(--md-sys-color-primary);
}

.btn--ghost:hover {
  background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
}

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
  padding: 0 12px;
}

.manual-add__error {
  margin: 0;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-medium);
}

.manual-add__success {
  margin: 0;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-body-medium);
}

.manual-add__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>