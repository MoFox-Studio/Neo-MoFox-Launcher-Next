<script setup lang="ts">
// 实例管理侧边栏的通用导航项：图标 + 标题 + 描述，点击派发给父组件。
defineProps<{
  active: boolean;
  icon: string;
  label: string;
  description: string;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    class="manage-sidebar__item state-layer"
    :class="{ 'manage-sidebar__item--active': active }"
    type="button"
    :aria-current="active ? 'page' : undefined"
    @click="emit('click')"
  >
    <span class="msr manage-sidebar__icon" :class="{ 'msr--fill': active }" aria-hidden="true">
      {{ icon }}
    </span>
    <span class="manage-sidebar__text">
      <span class="manage-sidebar__label">{{ label }}</span>
      <span class="manage-sidebar__description">{{ description }}</span>
    </span>
  </button>
</template>

<style scoped>
.manage-sidebar__item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 16px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.manage-sidebar__item--active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.manage-sidebar__icon {
  flex: 0 0 auto;
  font-size: 24px;
}

.manage-sidebar__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.manage-sidebar__label {
  font: var(--md-sys-typescale-label-large);
}

.manage-sidebar__description {
  overflow: hidden;
  color: inherit;
  font: var(--md-sys-typescale-body-small);
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
