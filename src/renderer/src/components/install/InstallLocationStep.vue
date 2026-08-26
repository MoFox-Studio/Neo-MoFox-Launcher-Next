<script setup lang="ts">
import { watch } from 'vue';
import { mofoxApi } from '@/services/mofox-api';
import { useSettingsStore } from '@/stores/settings';
import { useInstallDraftStore } from '@/stores/install-draft';

// 安装位置步骤：选择实例的安装目录，默认基于设置中的默认安装目录拼接实例名。
const store = useInstallDraftStore();
const draft = store.draft;
const settingsStore = useSettingsStore();

// 仅当用户尚未手动编辑过目录时，跟随实例名称与默认目录自动填充。
watch(
  [() => draft.instanceName, () => settingsStore.settings.defaultInstallDir],
  () => {
    const base = settingsStore.settings.defaultInstallDir;
    const name = draft.instanceName.trim();
    if (!base || !name) return;
    const sep = base.endsWith('\\') || base.endsWith('/') ? '' : base.includes('\\') ? '\\' : '/';
    draft.targetDir = `${base}${sep}${name}`;
  },
  { immediate: true },
);

async function chooseTargetDir(): Promise<void> {
  const selected = await mofoxApi.pickDirectory({
    title: '选择安装目录',
    defaultPath: draft.targetDir || settingsStore.settings.defaultInstallDir || undefined,
  });
  if (!selected) return;
  draft.targetDir = selected;
  store.touch('targetDir');
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '未知';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
</script>

<template>
  <section class="step">
    <div class="step-header">
      <h1>安装位置</h1>
      <p>选择实例文件存放的目标目录。</p>
    </div>

    <form class="config-form" @submit.prevent>
      <div class="form-group">
        <div class="path-field">
          <label
            class="field field--grow"
            :class="{ 'field--error': store.isInvalid('targetDir') }"
          >
            <input
              id="input-install-dir"
              v-model="draft.targetDir"
              class="field__input"
              type="text"
              placeholder=" "
              @input="store.touch('targetDir')"
            />
            <span class="field__label">安装目录 *</span>
          </label>
          <button type="button" class="btn btn--tonal state-layer" @click="chooseTargetDir">
            <span class="msr" aria-hidden="true">folder_open</span>
            浏览
          </button>
        </div>
        <p v-if="store.isInvalid('targetDir')" class="field__support field__support--error">
          {{ store.fieldErrors.targetDir }}
        </p>
        <p v-else-if="store.targetDirCheckError" class="field__support field__support--error">
          {{ store.targetDirCheckError }}
        </p>
        <p v-else-if="store.validatingTargetDir" class="field__support">
          正在校验目录空间与写入权限…
        </p>
        <p
          v-else-if="store.targetDirCheck?.writable"
          class="field__support"
        >
          已确认可写入，剩余空间 {{ formatBytes(store.targetDirCheck.freeSpaceBytes) }}
        </p>
        <p v-else class="field__support">不建议包含中文或空格</p>
      </div>

      <div class="info-box">
        <span class="msr" aria-hidden="true">info</span>
        <div>
          <strong>安装方式</strong>
          <p>安装会先在临时目录完成，成功后再原子移动到所选目录下以实例 ID 命名的子文件夹。</p>
        </div>
      </div>
    </form>
  </section>
</template>
