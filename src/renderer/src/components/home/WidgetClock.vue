<script setup lang="ts">
// 时钟部件：大号时间、可选日期与问候语；每秒本地刷新，无网络依赖。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ClockWidgetConfig } from '@shared/domain/home';
import HomeWidgetCard from './HomeWidgetCard.vue';
import { greetingByHour } from '@/utils/greeting';

const props = defineProps<{ config: ClockWidgetConfig }>();

const now = ref(new Date());
let timer: number | undefined;

onMounted(() => {
  timer = window.setInterval(() => {
    now.value = new Date();
  }, 1000);
});

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
});

const timeText = computed(() =>
  now.value.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !props.config.hour24,
  }),
);

const dateText = computed(() =>
  now.value.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }),
);

const greeting = computed(() => greetingByHour(now.value.getHours()));
</script>

<template>
  <HomeWidgetCard class="clock-widget">
    <div class="clock-widget__body">
      <p class="clock-widget__time">{{ timeText }}</p>
      <p v-if="config.showDate" class="clock-widget__date">{{ dateText }}</p>
      <p v-if="config.showGreeting" class="clock-widget__greeting">{{ greeting }}</p>
    </div>
  </HomeWidgetCard>
</template>

<style scoped>
.clock-widget__body {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
}

.clock-widget__body p {
  margin: 0;
}

.clock-widget__time {
  font: var(--md-sys-typescale-display-medium);
  font-variant-numeric: tabular-nums;
  color: var(--md-sys-color-on-surface);
}

.clock-widget__date {
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
}

.clock-widget__greeting {
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-primary);
}
</style>
