<script setup lang="ts">
import { ref } from 'vue';
import type { HomeLinkEntry, LinksWidgetConfig } from '@shared/domain/home';
import { isHomeLinkEntry } from '@shared/domain/home';
import { mofoxApi } from '@/services/mofox-api';
import HomeWidgetCard from './HomeWidgetCard.vue';
defineProps<{ config: LinksWidgetConfig }>();
const error = ref('');
function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '待填写网址';
  }
}
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
        <span class="home-links__mark" aria-hidden="true">{{
          entry.name.trim().slice(0, 1) || '+'
        }}</span>
        <span class="home-links__copy"
          ><strong>{{ entry.name || '未命名链接' }}</strong
          ><small>{{ hostname(entry.url) }}</small></span
        >
        <span class="msr home-links__arrow" aria-hidden="true">north_east</span>
      </button>
    </div>
    <p v-if="!config.links.length" class="home-widget__placeholder">在布局编辑器中添加常用网址。</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </HomeWidgetCard>
</template>
<style scoped>
.home-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
  gap: 8px;
}
button {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 68px;
  padding: 12px;
  text-align: left;
  border: 1px solid var(--app-glass-border);
  border-radius: 16px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-primary);
  cursor: pointer;
}
button span:last-child {
  overflow-wrap: anywhere;
}
.home-links__mark {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-size: 18px;
}
.home-links__copy {
  display: grid;
  gap: 4px;
  flex: 1;
  min-width: 0;
  color: var(--md-sys-color-on-surface);
}
.home-links__copy strong,
.home-links__copy small {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.home-links__copy small {
  color: var(--md-sys-color-on-surface-variant);
}
.home-links__arrow {
  font-size: 18px;
}
button {
  transition:
    background var(--app-motion-duration-spatial),
    transform var(--app-motion-duration-spatial);
}
button:hover {
  background: var(--md-sys-color-secondary-container);
  transform: translateY(-2px);
}
button:active {
  transform: translateY(0);
}
[role='alert'] {
  padding: 12px;
  border-radius: 12px;
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
}
</style>
