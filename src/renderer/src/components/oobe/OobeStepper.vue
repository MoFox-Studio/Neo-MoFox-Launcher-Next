<script setup lang="ts">
interface Step {
  id: string;
  label: string;
  /** 该步骤是否在当前流程中实际可见（例如未检测到旧版时跳过导入步骤）。 */
  visible: boolean;
}

interface Props {
  steps: Step[];
  current: number;
}

const props = defineProps<Props>();
</script>

<template>
  <!-- 步骤进度点，仅显示 visible 的步骤 -->
  <div class="oobe-stepper">
    <span
      v-for="(step, idx) in props.steps.filter((s) => s.visible)"
      :key="step.id"
      class="oobe-stepper__dot"
      :class="{
        'oobe-stepper__dot--active': idx + 1 === props.current,
        'oobe-stepper__dot--done': idx + 1 < props.current,
      }"
      :title="step.label"
    ></span>
  </div>
</template>

<style scoped>
.oobe-stepper {
  display: flex;
  gap: 8px;
  margin-bottom: 48px;
}

.oobe-stepper__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.oobe-stepper__dot--active {
  background: var(--md-sys-color-primary);
}

.oobe-stepper__dot--done {
  background: var(--md-sys-color-tertiary);
}
</style>
