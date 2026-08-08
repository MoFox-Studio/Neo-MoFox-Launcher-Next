<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import InstallWizard from '@/components/install/InstallWizard.vue';
import ManualImportWizard from '@/components/install/ManualImportWizard.vue';

type InstallMode = 'fresh' | 'import';

const route = useRoute();
const router = useRouter();

// 路由参数只由加号入口写入；缺省时保留新鲜安装作为直接访问的默认流程。
const mode = computed<InstallMode>(() => (route.params.mode === 'import' ? 'import' : 'fresh'));
const title = computed(() => (mode.value === 'import' ? '手动导入实例' : '新鲜安装实例'));
const subtitle = computed(() =>
  mode.value === 'import' ? '登记本机已有的 Neo-MoFox 目录' : '下载并配置新的机器人平台实例',
);

function leave(): void {
  void router.push({ name: 'instances' });
}
</script>

<template>
  <div class="install-view">
    <header class="install-view__header">
      <button class="back-btn state-layer" type="button" @click="leave">
        <span class="msr" aria-hidden="true">arrow_back</span>
        返回实例
      </button>
      <div class="install-view__heading">
        <h1>{{ title }}</h1>
        <p>{{ subtitle }}</p>
      </div>
    </header>

    <div class="install-view__content">
      <InstallWizard v-if="mode === 'fresh'" @close="leave" @complete="leave" />
      <ManualImportWizard v-else @close="leave" @complete="leave" />
    </div>
  </div>
</template>

<style scoped>
.install-view {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.install-view__header {
  display: flex;
  min-height: 72px;
  align-items: center;
  gap: 20px;
  padding: 12px 28px;
  border-bottom: 1px solid var(--app-glass-border);
  background: color-mix(in srgb, var(--md-sys-color-surface) 80%, transparent);
}

.back-btn {
  position: relative;
  display: inline-flex;
  height: 40px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.back-btn .msr {
  font-size: 20px;
}

.install-view__heading {
  min-width: 0;
}

.install-view__heading h1,
.install-view__heading p {
  margin: 0;
}

.install-view__heading h1 {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-large);
}

.install-view__heading p {
  overflow: hidden;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.install-view__content {
  min-height: 0;
  flex: 1;
}

@media (max-width: 640px) {
  .install-view__header {
    gap: 12px;
    padding-inline: 16px;
  }

  .back-btn {
    width: 40px;
    justify-content: center;
    padding: 0;
    font-size: 0;
  }
}
</style>
