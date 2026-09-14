<script setup lang="ts">
interface Step {
  id: string;
  label: string;
  visible: boolean;
}

const props = defineProps<{
  steps: Step[];
  current: number;
}>();
</script>

<template>
  <ol class="oobe-stepper" aria-label="初始设置进度">
    <li
      v-for="(step, index) in props.steps.filter((item) => item.visible)"
      :key="step.id"
      class="oobe-stepper__item"
      :class="{
        'oobe-stepper__item--active': index + 1 === props.current,
        'oobe-stepper__item--done': index + 1 < props.current,
      }"
      :aria-current="index + 1 === props.current ? 'step' : undefined"
    >
      <span class="oobe-stepper__marker" aria-hidden="true">
        <span v-if="index + 1 < props.current" class="msr">check</span>
        <span v-else>{{ index + 1 }}</span>
      </span>
      <span class="oobe-stepper__label">{{ step.label }}</span>
    </li>
  </ol>
</template>

<style scoped>
.oobe-stepper {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 3px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.oobe-stepper__item {
  min-width: 0;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-medium);
  transition:
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.oobe-stepper__item:first-child {
  border-radius: 15px 6px 6px 15px;
}

.oobe-stepper__item:last-child {
  border-radius: 6px 15px 15px 6px;
}

.oobe-stepper__item--active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.oobe-stepper__item--done {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.oobe-stepper__marker {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, currentColor 10%, transparent);
  font: var(--md-sys-typescale-label-small);
}

.oobe-stepper__marker .msr {
  font-size: 15px;
}

.oobe-stepper__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .oobe-stepper__label {
    display: none;
  }
}
</style>
