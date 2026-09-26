<script setup lang="ts">
// 主页小部件共享外壳：玻璃卡片语言与仪表盘 Hero、空状态一致。
defineProps<{
  /** 标题；缺省时不渲染头部（如时钟、仪表盘等自释部件）。 */
  title?: string;
  /** 头部图标（Material Symbols 名称）。 */
  icon?: string;
}>();
</script>

<template>
  <section class="home-widget">
    <header v-if="title" class="home-widget__header">
      <span v-if="icon" class="msr home-widget__icon" aria-hidden="true">{{ icon }}</span>
      <h2>{{ title }}</h2>
      <div v-if="$slots.actions" class="home-widget__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="home-widget__body">
      <slot />
    </div>
  </section>
</template>
