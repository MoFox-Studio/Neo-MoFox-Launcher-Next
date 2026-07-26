<script setup lang="ts">
interface Props {
  title: string;
  subtitle?: string;
}

defineProps<Props>();
</script>

<template>
  <header class="page-header">
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
