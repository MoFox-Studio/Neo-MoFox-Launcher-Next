<script setup lang="ts">
import { useRouter } from 'vue-router';
import BaseDialog from '@/components/BaseDialog.vue';
import { useAddInstanceStore } from '@/stores/add-instance';

type InstallMode = 'fresh' | 'import';

const router = useRouter();
const addInstanceStore = useAddInstanceStore();

function close(): void {
  addInstanceStore.close();
}

function choose(mode: InstallMode): void {
  close();
  void router.push({ name: 'install', params: { mode } });
}
</script>

<template>
  <BaseDialog
    :open="addInstanceStore.open"
    title="添加实例"
    :width="460"
    :show-actions="false"
    @close="close"
  >
    <div class="choice">
      <p class="choice__intro">选择创建实例的方式。</p>
      <div class="choice__grid">
        <button class="choice-card state-layer" type="button" @click="choose('fresh')">
          <span class="msr choice-card__icon" aria-hidden="true">download</span>
          <span class="choice-card__content">
            <span class="choice-card__title">新鲜安装</span>
            <span class="choice-card__desc">下载并配置一个全新的机器人平台实例</span>
          </span>
          <span class="msr choice-card__arrow" aria-hidden="true">arrow_forward</span>
        </button>
        <button class="choice-card state-layer" type="button" @click="choose('import')">
          <span class="msr choice-card__icon" aria-hidden="true">folder_copy</span>
          <span class="choice-card__content">
            <span class="choice-card__title">手动导入</span>
            <span class="choice-card__desc">登记本机已有的 Neo-MoFox 与平台目录</span>
          </span>
          <span class="msr choice-card__arrow" aria-hidden="true">arrow_forward</span>
        </button>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
.choice {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.choice__intro {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.choice__grid {
  display: grid;
  gap: 12px;
}

.choice-card {
  display: grid;
  min-height: 96px;
  grid-template-columns: 48px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
}

.choice-card:hover {
  border-color: var(--md-sys-color-primary);
  background: var(--md-sys-color-secondary-container);
  transform: translateY(-1px);
}

.choice-card:active {
  transform: scale(0.99);
}

.choice-card__icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 16px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  font-size: 26px;
}

.choice-card__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.choice-card__title {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-medium);
}

.choice-card__desc {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  line-height: 1.45;
}

.choice-card__arrow {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 20px;
  transition: transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.choice-card:hover .choice-card__arrow {
  transform: translateX(3px);
  color: var(--md-sys-color-primary);
}

@media (prefers-reduced-motion: reduce) {
  .choice-card,
  .choice-card__arrow {
    transition: none;
  }

  .choice-card:hover,
  .choice-card:active,
  .choice-card:hover .choice-card__arrow {
    transform: none;
  }
}
</style>
