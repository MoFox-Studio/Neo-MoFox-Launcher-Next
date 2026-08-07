<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import PageHeader from '@/components/PageHeader.vue';

const route = useRoute();
const router = useRouter();
const instancesStore = useInstancesStore();
const instanceId = computed(() => String(route.params.id ?? ''));
const instance = computed(() => instancesStore.byId(instanceId.value));
const mofoxPath = ref('');
const platformPaths = ref<Array<{ id: string; path: string }>>([]);
const busy = ref(false);
const errorMessage = ref<string | null>(null);
const isLocked = computed(() => {
  const status = instance.value?.status;
  return status === 'running' || status === 'starting' || status === 'stopping';
});

watch(
  instance,
  (value) => {
    if (!value) return;
    mofoxPath.value = value.mofoxInstallDir;
    platformPaths.value = Object.entries(value.platforms).map(([id, path]) => ({ id, path }));
    if (platformPaths.value.length === 0) platformPaths.value.push({ id: '', path: '' });
  },
  { immediate: true },
);

onMounted(async () => {
  if (!instance.value) await instancesStore.refresh();
});

function goBack(): void {
  void router.push({ name: 'instances' });
}

function addPlatform(): void {
  platformPaths.value.push({ id: '', path: '' });
}

function removePlatform(index: number): void {
  if (platformPaths.value.length > 1) platformPaths.value.splice(index, 1);
}

async function chooseMofoxPath(): Promise<void> {
  const selected = await mofoxApi.pickDirectory({
    title: '选择 MoFox 目录',
    defaultPath: mofoxPath.value || undefined,
  });
  if (selected) mofoxPath.value = selected;
}

async function choosePlatformPath(index: number): Promise<void> {
  const entry = platformPaths.value[index];
  if (!entry) return;
  const selected = await mofoxApi.pickDirectory({
    title: `选择 ${entry.id || '平台'} 目录`,
    defaultPath: entry.path || undefined,
  });
  if (selected) entry.path = selected;
}

async function save(): Promise<void> {
  if (!instance.value || isLocked.value) return;
  const mofoxInstallDir = mofoxPath.value.trim();
  const entries = platformPaths.value.map(({ id, path }) => [id.trim(), path.trim()] as const);
  if (!mofoxInstallDir || entries.some(([id, path]) => !id || !path)) {
    errorMessage.value = 'MoFox 目录、平台 ID 和平台目录不能为空';
    return;
  }
  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    errorMessage.value = '平台 ID 不能重复';
    return;
  }
  busy.value = true;
  errorMessage.value = null;
  try {
    await instancesStore.updatePaths(instance.value.id, {
      mofoxInstallDir,
      platforms: Object.fromEntries(entries),
    });
    goBack();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存路径失败';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="paths-view">
    <PageHeader title="配置实例路径" :subtitle="instance?.name ?? '实例不存在'">
      <button class="icon-btn state-layer" type="button" title="返回" aria-label="返回实例列表" @click="goBack">
        <span class="msr" aria-hidden="true">arrow_back</span>
      </button>
    </PageHeader>

    <main v-if="instance" class="paths-view__body">
      <p v-if="isLocked" class="notice">当前实例正在运行。停止实例后才能修改并保存路径。</p>

      <section class="path-section">
        <h2 class="path-section__title">MoFox</h2>
        <label class="field">
          <span class="field__label">本体目录</span>
          <div class="field__control">
            <input v-model="mofoxPath" class="field__input" type="text" :disabled="isLocked" />
            <button class="icon-btn state-layer" type="button" title="选择目录" aria-label="选择 MoFox 目录" :disabled="isLocked" @click="chooseMofoxPath">
              <span class="msr" aria-hidden="true">folder_open</span>
            </button>
          </div>
        </label>
      </section>

      <section class="path-section">
        <div class="path-section__header">
          <h2 class="path-section__title">平台</h2>
          <button class="btn btn--text state-layer" type="button" :disabled="isLocked" @click="addPlatform">
            <span class="msr" aria-hidden="true">add</span>
            添加平台
          </button>
        </div>

        <div v-for="(entry, index) in platformPaths" :key="index" class="platform-row">
          <label class="field field--id">
            <span class="field__label">平台 ID</span>
            <input v-model="entry.id" class="field__input" type="text" placeholder="snowluma" :disabled="isLocked" />
          </label>
          <label class="field">
            <span class="field__label">运行目录</span>
            <div class="field__control field__control--platform">
              <input v-model="entry.path" class="field__input" type="text" :disabled="isLocked" />
              <button class="icon-btn state-layer" type="button" title="选择目录" :disabled="isLocked" @click="choosePlatformPath(index)">
                <span class="msr" aria-hidden="true">folder_open</span>
              </button>
              <button class="icon-btn state-layer" type="button" title="移除平台" :disabled="isLocked || platformPaths.length <= 1" @click="removePlatform(index)">
                <span class="msr" aria-hidden="true">remove_circle</span>
              </button>
            </div>
          </label>
        </div>
      </section>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <div class="paths-view__actions">
        <button class="btn btn--text state-layer" type="button" :disabled="busy" @click="goBack">取消</button>
        <button class="btn btn--filled state-layer" type="button" :disabled="busy || isLocked" @click="save">保存</button>
      </div>
    </main>

    <div v-else class="empty-state">
      <p>未找到该实例</p>
      <button class="btn btn--filled state-layer" type="button" @click="goBack">返回实例列表</button>
    </div>
  </div>
</template>

<style scoped>
.paths-view {
  height: 100%;
  overflow-y: auto;
}

.paths-view__body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: min(820px, calc(100% - 64px));
  margin: 0 auto;
  padding-bottom: 48px;
}

.notice {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-body-medium);
}

.path-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 0;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}

.path-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.path-section__title {
  margin: 0;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-medium);
}

.platform-row {
  display: grid;
  grid-template-columns: minmax(140px, 0.35fr) minmax(0, 1fr);
  gap: 12px;
}

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.field__label {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
}

.field__control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  align-items: center;
  gap: 8px;
}

.field__control--platform {
  grid-template-columns: minmax(0, 1fr) 40px 40px;
}

.field__input {
  width: 100%;
  min-width: 0;
  height: 48px;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-small);
  outline: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-medium);
  font-family: var(--md-ref-typeface-mono);
}

.field__input:focus {
  border: 2px solid var(--md-sys-color-primary);
  padding: 0 13px;
}

.field__input:disabled,
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.paths-view__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.error-message {
  margin: 0;
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-body-medium);
}

.btn {
  display: inline-flex;
  height: 40px;
  align-items: center;
  gap: 6px;
  padding: 0 20px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
}

.icon-btn {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}

.empty-state {
  display: grid;
  min-height: 300px;
  place-items: center;
  align-content: center;
  gap: 16px;
}

@media (max-width: 680px) {
  .paths-view__body {
    width: calc(100% - 32px);
  }

  .platform-row {
    grid-template-columns: 1fr;
  }
}
</style>
