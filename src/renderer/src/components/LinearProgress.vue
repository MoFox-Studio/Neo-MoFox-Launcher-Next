<script setup lang="ts">
import { computed } from 'vue';

// MD3 线性进度指示器：4px 圆角轨道，右侧留出停止点与间隙；
// indeterminate 时隐藏停止点，双指示条循环追逐。
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
// 接近完成时指示条占满整条轨道并隐藏停止点，与 100% 状态自然衔接。
const isComplete = computed(() => !props.indeterminate && normalizedProgress.value >= 0.995);
const barStyle = computed(() => ({ width: `${normalizedProgress.value * 100}%` }));
</script>

<template>
  <div
    class="linear-progress"
    :class="{
      'linear-progress--complete': isComplete,
      'linear-progress--indeterminate': indeterminate,
    }"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="indeterminate ? undefined : percent"
    :aria-valuetext="indeterminate ? '正在处理' : `${percent}%`"
    :aria-label="label"
  >
    <span class="linear-progress__track" aria-hidden="true">
      <template v-if="indeterminate">
        <span class="linear-progress__bar linear-progress__bar--a"></span>
        <span class="linear-progress__bar linear-progress__bar--b"></span>
      </template>
      <span v-else class="linear-progress__bar" :style="barStyle"></span>
    </span>
    <span
      v-if="!indeterminate"
      class="linear-progress__stop"
      :class="{ 'linear-progress__stop--hidden': isComplete }"
      aria-hidden="true"
    ></span>
  </div>
</template>

<style scoped>
.linear-progress {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
}

.linear-progress__track {
  position: absolute;
  inset: 0 8px 0 0;
  overflow: hidden;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(
    --linear-progress-track-color,
    color-mix(in srgb, var(--md-sys-color-primary) 18%, transparent)
  );
  transition: right var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

/* 完成时轨道延伸到最右，与停止点合并为满条。 */
.linear-progress--complete .linear-progress__track,
.linear-progress--indeterminate .linear-progress__track {
  right: 0;
}

.linear-progress__bar {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--linear-progress-indicator-color, var(--md-sys-color-primary));
  transition: width var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

.linear-progress__stop {
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 4px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--linear-progress-indicator-color, var(--md-sys-color-primary));
  transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.linear-progress__stop--hidden {
  opacity: 0;
}

.linear-progress__bar--a {
  width: 40%;
  animation: linear-progress-bar-a 1.9s infinite;
}

.linear-progress__bar--b {
  width: 25%;
  animation: linear-progress-bar-b 1.9s infinite;
}

@keyframes linear-progress-bar-a {
  0% {
    left: -40%;
    animation-timing-function: cubic-bezier(0.3, 0, 0.8, 0.15);
  }

  50% {
    left: 30%;
    animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.5);
  }

  100% {
    left: 100%;
  }
}

@keyframes linear-progress-bar-b {
  0%,
  30% {
    left: -25%;
    animation-timing-function: cubic-bezier(0.15, 0, 0.5156, 0.4096);
  }

  70% {
    left: 45%;
    animation-timing-function: cubic-bezier(0.5, 0, 0.7, 0.5);
  }

  100% {
    left: 100%;
  }
}

/* 与应用全局动效降级约定保持一致：reduced/none 停止追逐，保留静止指示条。 */
:global(html[data-motion='reduced']) .linear-progress__bar--a,
:global(html[data-motion='none']) .linear-progress__bar--a {
  animation: none;
  left: 40%;
}

:global(html[data-motion='reduced']) .linear-progress__bar--b,
:global(html[data-motion='none']) .linear-progress__bar--b {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .linear-progress__bar--a,
  .linear-progress__bar--b {
    animation-duration: 2.4s;
  }
}
</style>
