<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    progress?: number;
    indeterminate?: boolean;
    label?: string;
  }>(),
  {
    progress: 0,
    indeterminate: false,
    label: '进度',
  },
);

const normalizedProgress = computed(() => Math.max(0, Math.min(1, props.progress)));
const percent = computed(() => Math.round(normalizedProgress.value * 100));
const isFlat = computed(
  () =>
    !props.indeterminate && (normalizedProgress.value <= 0 || normalizedProgress.value >= 0.995),
);
const activeStyle = computed(() => ({ width: `${normalizedProgress.value * 100}%` }));
const trackStyle = computed(() => ({
  left: `calc(${normalizedProgress.value * 100}% + 8px)`,
}));
</script>

<template>
  <div
    class="wavy-linear-progress"
    :class="{
      'wavy-linear-progress--flat': isFlat,
      'wavy-linear-progress--indeterminate': indeterminate,
      'wavy-linear-progress--empty': !indeterminate && normalizedProgress <= 0,
    }"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="indeterminate ? undefined : percent"
    :aria-valuetext="indeterminate ? '正在处理' : `${percent}%`"
    :aria-label="label"
  >
    <span
      class="wavy-linear-progress__track"
      :style="indeterminate ? undefined : trackStyle"
      aria-hidden="true"
    ></span>
    <span
      class="wavy-linear-progress__stop"
      :class="{ 'wavy-linear-progress__stop--hidden': !indeterminate && percent >= 98 }"
      aria-hidden="true"
    ></span>

    <span
      v-if="indeterminate"
      class="wavy-linear-progress__active wavy-linear-progress__active--indeterminate"
      aria-hidden="true"
    >
      <span class="wavy-linear-progress__wave"></span>
    </span>
    <span v-else class="wavy-linear-progress__active" :style="activeStyle" aria-hidden="true">
      <span class="wavy-linear-progress__wave"></span>
    </span>
  </div>
</template>

<style scoped>
.wavy-linear-progress {
  position: relative;
  width: 100%;
  height: 18px;
  overflow: hidden;
  color: var(--md-sys-color-primary);
}

.wavy-linear-progress__track {
  position: absolute;
  top: 7px;
  right: 8px;
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-on-primary-container) 18%, transparent);
  transition: left var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.wavy-linear-progress--indeterminate .wavy-linear-progress__track {
  left: 0;
}

.wavy-linear-progress__stop {
  position: absolute;
  top: 7px;
  right: 0;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--md-sys-color-on-primary-container) 40%, transparent);
  transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.wavy-linear-progress__stop--hidden {
  opacity: 0;
}

.wavy-linear-progress__active {
  position: absolute;
  inset: 0 auto 0 0;
  min-width: 0;
  overflow: hidden;
  transition: width var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

.wavy-linear-progress__wave {
  position: absolute;
  inset: 0;
  background: currentColor;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='18' viewBox='0 0 40 18'%3E%3Cpath d='M0 9 C5 9 5 4 10 4 S15 9 20 9 S25 14 30 14 S35 9 40 9' fill='none' stroke='black' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E");
  -webkit-mask-position: 0 0;
  -webkit-mask-repeat: repeat-x;
  -webkit-mask-size: 40px 18px;
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='18' viewBox='0 0 40 18'%3E%3Cpath d='M0 9 C5 9 5 4 10 4 S15 9 20 9 S25 14 30 14 S35 9 40 9' fill='none' stroke='black' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E");
  mask-position: 0 0;
  mask-repeat: repeat-x;
  mask-size: 40px 18px;
  animation: wavy-progress-flow 680ms linear infinite;
}

.wavy-linear-progress--flat .wavy-linear-progress__wave {
  inset: 7px 0 auto;
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
  -webkit-mask-image: none;
  mask-image: none;
  animation: none;
}

.wavy-linear-progress--empty .wavy-linear-progress__active {
  opacity: 0;
}

.wavy-linear-progress__active--indeterminate {
  width: 34%;
  animation: wavy-progress-scan 1.45s var(--md-sys-motion-easing-emphasized) infinite;
}

@keyframes wavy-progress-flow {
  from {
    -webkit-mask-position: 0 0;
    mask-position: 0 0;
  }

  to {
    -webkit-mask-position: -40px 0;
    mask-position: -40px 0;
  }
}

@keyframes wavy-progress-scan {
  from {
    transform: translateX(-105%);
  }

  to {
    transform: translateX(395%);
  }
}

:global(html[data-motion='reduced']) .wavy-linear-progress__wave,
:global(html[data-motion='none']) .wavy-linear-progress__wave {
  inset: 7px 0 auto;
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
  -webkit-mask-image: none;
  mask-image: none;
  animation: none;
}

:global(html[data-motion='none']) .wavy-linear-progress__active--indeterminate {
  animation: none;
  transform: translateX(95%);
}

@media (prefers-reduced-motion: reduce) {
  :global(html[data-motion='system']) .wavy-linear-progress__wave {
    inset: 7px 0 auto;
    height: 4px;
    border-radius: var(--md-sys-shape-corner-full);
    -webkit-mask-image: none;
    mask-image: none;
    animation: none;
  }

  .wavy-linear-progress__active--indeterminate {
    animation-duration: 2.4s;
  }
}
</style>
