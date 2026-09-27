<script setup lang="ts">
import { ref } from 'vue';
import type { HomeLinkEntry, LinksWidgetConfig } from '@shared/domain/home';
import { isHomeLinkEntry } from '@shared/domain/home';
import { mofoxApi } from '@/services/mofox-api';
import HomeWidgetCard from './HomeWidgetCard.vue';
defineProps<{ config: LinksWidgetConfig }>();
const error = ref('');
async function open(entry: HomeLinkEntry): Promise<void> {
  error.value = '';
  if (!isHomeLinkEntry(entry)) {
    error.value = '链接无效，请在布局编辑器中修改';
    return;
  }
  try {
    await mofoxApi.openExternal(entry.url);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '打开链接失败';
  }
}
</script>
<template>
  <HomeWidgetCard title="常用链接" icon="link">
    <div class="home-links">
      <button
        v-for="entry in config.links"
        :key="entry.id"
        type="button"
        :title="entry.url"
        @click="open(entry)"
      >
        <span class="msr" aria-hidden="true">open_in_new</span><span>{{ entry.name }}</span>
      </button>
    </div>
    <p v-if="!config.links.length" class="home-widget__placeholder">在布局编辑器中添加常用网址。</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </HomeWidgetCard>
</template>
<style scoped>
.home-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  gap: 8px;
}
button {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 48px;
  padding: 12px;
  text-align: left;
  border: 1px solid var(--app-glass-border);
  border-radius: 16px;
  background: var(--app-glass-row);
  color: var(--md-sys-color-primary);
  cursor: pointer;
}
button span:last-child {
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--md-sys-color-error);
}
</style>
