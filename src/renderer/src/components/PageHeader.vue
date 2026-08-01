<script setup lang="ts">
// 复用页面标题栏，并向页面暴露右侧操作插槽。
interface Props {
  title: string;
  subtitle?: string;
}

defineProps<Props>();
</script>

<template>
  <header class="page-header">
    <!-- 标题说明与页面级操作 -->
    <div class="page-header__text">
      <h1 class="page-header__title">{{ title }}</h1>
      <p v-if="subtitle" class="page-header__subtitle">{{ subtitle }}</p>
    </div>
    <div class="page-header__actions">
      <slot />
    </div>
  </header>
</template>

<style scoped>
/* 页面标题栏的文本与操作区布局 */
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 32px;
}

.page-header__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.page-header__title {
  margin: 0;
  font: var(--md-sys-typescale-headline-small);
  color: var(--md-sys-color-on-surface);
}

.page-header__subtitle {
  margin: 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
</style>
