<script setup lang="ts">
import type { NotesWidgetConfig } from '@shared/domain/home';
import HomeWidgetCard from './HomeWidgetCard.vue';
defineProps<{ config: NotesWidgetConfig }>();
</script>
<template>
  <HomeWidgetCard title="便签" icon="sticky_note_2">
    <p v-if="config.text.trim()" class="note-text">{{ config.text }}</p>
    <div v-else class="home-widget__placeholder">
      把待办事项、运行提醒写在这里。<br />在主页布局编辑器中编辑便签。
    </div>
  </HomeWidgetCard>
</template>
<style scoped>
.note-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  line-height: 1.8;
}
</style>
