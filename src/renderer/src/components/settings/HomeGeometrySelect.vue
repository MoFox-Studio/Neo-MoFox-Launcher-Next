<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
const props = defineProps<{
  modelValue: string;
  label: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const select = ref<{ value: string }>();
watch(
  [select, () => props.modelValue],
  async () => {
    await nextTick();
    if (select.value) select.value.value = props.modelValue;
  },
  { flush: 'post' },
);
function change(event: Event): void {
  const value = (event.target as HTMLElement & { value: string }).value;
  if (props.options.some((option) => option.value === value)) emit('update:modelValue', value);
}
</script>
<template>
  <md-outlined-select
    ref="select"
    :label="label"
    :aria-label="label"
    :disabled="disabled"
    menu-positioning="popover"
    @change="change"
  >
    <!-- eslint-disable vue/no-deprecated-slot-attribute -->
    <md-select-option
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :selected="modelValue === option.value"
    >
      <div slot="headline">{{ option.label }}</div>
    </md-select-option>
    <!-- eslint-enable vue/no-deprecated-slot-attribute -->
  </md-outlined-select>
</template>
<style scoped>
md-outlined-select {
  width: 100%;
  min-width: 0;
  margin: 8px 0;
}
</style>
