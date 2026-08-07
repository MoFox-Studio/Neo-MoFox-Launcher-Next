<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseDialog from './BaseDialog.vue';
import { useAddInstanceStore } from '@/stores/add-instance';

// 新建实例弹窗：提供“完整安装”、“导入整合包”、“手动添加已有实例”三条入口。
const addInstanceStore = useAddInstanceStore();
const router = useRouter();

const busy = ref(false);

function goInstall(): void {
  addInstanceStore.close();
  void router.push({ name: 'install' });
}

function goImport(): void {
  addInstanceStore.close();
  void router.push({ name: 'import-pack' });
}

function goManualAdd(): void {
  addInstanceStore.close();
  void router.push({ name: 'manual-add' });
}

function onClose(): void {
  addInstanceStore.close();
}
</script>

<template>
  <BaseDialog
    :open="addInstanceStore.open"
    title="新建实例"
    :width="440"
    :dismissible="!busy"
    :show-actions="false"
    @close="onClose"
  >
    <p class="add-instance__hint">选择一种方式创建新实例：</p>
    <div class="add-instance__grid">
      <button class="add-instance__card state-layer" type="button" @click="goInstall">
        <span class="msr add-instance__icon" aria-hidden="true">download</span>
        <span class="add-instance__title">完整安装</span>
        <span class="add-instance__desc">下载 MoFox 主程序与平台，配置新实例</span>
        <span class="msr add-instance__arrow" aria-hidden="true">chevron_right</span>
      </button>
      <button class="add-instance__card state-layer" type="button" @click="goImport">
        <span class="msr add-instance__icon" aria-hidden="true">package</span>
        <span class="add-instance__title">导入整合包</span>
        <span class="add-instance__desc">从 .mfpack 整合包还原一个实例</span>
        <span class="msr add-instance__arrow" aria-hidden="true">chevron_right</span>
      </button>
      <button class="add-instance__card state-layer" type="button" @click="goManualAdd">
        <span class="msr add-instance__icon" aria-hidden="true">folder_open</span>
        <span class="add-instance__title">手动添加</span>
        <span class="add-instance__desc">直接注册本机已有的 MoFox 安装目录</span>
        <span class="msr add-instance__arrow" aria-hidden="true">chevron_right</span>
      </button>
    </div>
  </BaseDialog>
</template>

<style scoped>
.add-instance__hint {
  margin: 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.add-instance__grid {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.add-instance__card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 24px;
  grid-template-rows: auto auto;
  column-gap: 14px;
  align-items: center;
  min-height: 88px;
  padding: 14px 16px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-large);
  background: color-mix(in srgb, var(--app-glass-card) 72%, transparent);
  color: var(--md-sys-color-on-surface);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.16);
  text-align: left;
  cursor: pointer;
  transition:
    transform var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.add-instance__card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--md-sys-color-primary) 34%, var(--app-glass-border));
  background: color-mix(in srgb, var(--md-sys-color-primary-container) 22%, var(--app-glass-card));
  box-shadow: var(--app-glass-card-shadow-hover);
}

.add-instance__card:active {
  transform: scale(0.99);
  transition-duration: var(--md-sys-motion-duration-short2);
}

.add-instance__icon {
  grid-row: 1 / -1;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--md-sys-color-primary-container) 72%, transparent);
  color: var(--md-sys-color-on-primary-container);
  font-size: 24px;
}

.add-instance__title {
  align-self: end;
  font: var(--md-sys-typescale-title-medium);
  color: var(--md-sys-color-on-surface);
}

.add-instance__desc {
  align-self: start;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.add-instance__arrow {
  grid-column: 3;
  grid-row: 1 / -1;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 20px;
  transition: transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.add-instance__card:hover .add-instance__arrow {
  transform: translateX(2px);
  color: var(--md-sys-color-primary);
}

@media (max-width: 420px) {
  .add-instance__card {
    grid-template-columns: 40px minmax(0, 1fr);
    min-height: 80px;
    padding: 12px;
  }

  .add-instance__icon {
    width: 40px;
    height: 40px;
  }

  .add-instance__arrow {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .add-instance__card,
  .add-instance__arrow {
    transition: none;
  }

  .add-instance__card:hover,
  .add-instance__card:active,
  .add-instance__card:hover .add-instance__arrow {
    transform: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .add-instance__card {
    background: var(--md-sys-color-surface-container);
  }
}
</style>