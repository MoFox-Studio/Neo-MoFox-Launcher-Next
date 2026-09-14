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

// Material 3 的默认振幅会在 10% 前与 95% 后归零，避免短波段和收尾阶段
// 出现难辨识的碎波形；中段才切换到完整波浪。
const isFlat = computed(
  () => props.indeterminate || normalizedProgress.value <= 0.1 || normalizedProgress.value >= 0.95,
);

const activeStyle = computed(() => ({
  strokeDasharray: `${normalizedProgress.value} 1`,
}));

const trackStyle = computed(() => {
  const trackStart = Math.min(1, normalizedProgress.value + 0.012);
  return {
    strokeDasharray: `${Math.max(0, 1 - trackStart)} 1`,
    strokeDashoffset: `${-trackStart}`,
  };
});

function buildWavePath(): string {
  const center = 9;
  const crest = 4;
  const trough = 14;
  const wavelength = 40;
  let path = `M 2 ${center}`;

  // 四段平滑三次曲线构成一个周期。路径稍微延伸出画布，确保右端不会
  // 因缩放产生缺口；真正显示的长度由 pathLength=1 的 dash 控制。
  for (let x = 2; x < 1002; x += wavelength) {
    path += ` C ${x + 5} ${center} ${x + 5} ${crest} ${x + 10} ${crest}`;
    path += ` S ${x + 15} ${center} ${x + 20} ${center}`;
    path += ` S ${x + 25} ${trough} ${x + 30} ${trough}`;
    path += ` S ${x + 35} ${center} ${x + 40} ${center}`;
  }

  return path;
}

const wavePath = buildWavePath();
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
    <svg
      class="wavy-linear-progress__graphic"
      viewBox="0 0 1000 18"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        class="wavy-linear-progress__track"
        d="M 2 9 L 988 9"
        pathLength="1"
        :style="indeterminate ? undefined : trackStyle"
      />
      <circle
        class="wavy-linear-progress__stop"
        :class="{ 'wavy-linear-progress__stop--hidden': !indeterminate && percent >= 98 }"
        cx="997"
        cy="9"
        r="2"
      />

      <template v-if="indeterminate">
        <path
          class="wavy-linear-progress__active wavy-linear-progress__indeterminate"
          d="M 2 9 L 998 9"
          pathLength="1"
        />
      </template>
      <template v-else>
        <path
          class="wavy-linear-progress__active wavy-linear-progress__flat"
          d="M 2 9 L 998 9"
          pathLength="1"
          :style="activeStyle"
        />
        <path
          class="wavy-linear-progress__active wavy-linear-progress__wave"
          :d="wavePath"
          pathLength="1"
          :style="activeStyle"
        />
      </template>
    </svg>
  </div>
</template>

<style scoped>
.wavy-linear-progress {
  width: 100%;
  height: 18px;
  color: var(--md-sys-color-primary);
}

.wavy-linear-progress__graphic {
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.wavy-linear-progress__track,
.wavy-linear-progress__active {
  fill: none;
  vector-effect: non-scaling-stroke;
  stroke-linecap: round;
  stroke-width: 4px;
}

.wavy-linear-progress__track {
  stroke: color-mix(in srgb, var(--md-sys-color-on-primary-container) 18%, transparent);
  transition:
    stroke-dasharray var(--md-sys-motion-duration-medium2)
      var(--md-sys-motion-easing-emphasized-decelerate),
    stroke-dashoffset var(--md-sys-motion-duration-medium2)
      var(--md-sys-motion-easing-emphasized-decelerate);
}

.wavy-linear-progress__stop {
  fill: color-mix(in srgb, var(--md-sys-color-on-primary-container) 40%, transparent);
  vector-effect: non-scaling-stroke;
  transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.wavy-linear-progress__stop--hidden {
  opacity: 0;
}

.wavy-linear-progress__active {
  stroke: currentColor;
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    stroke-dasharray var(--md-sys-motion-duration-medium2)
      var(--md-sys-motion-easing-emphasized-decelerate);
}

.wavy-linear-progress__flat {
  opacity: 0;
}

.wavy-linear-progress__wave {
  opacity: 1;
}

.wavy-linear-progress--flat .wavy-linear-progress__flat {
  opacity: 1;
}

.wavy-linear-progress--flat .wavy-linear-progress__wave {
  opacity: 0;
}

.wavy-linear-progress--empty .wavy-linear-progress__active {
  opacity: 0;
}

.wavy-linear-progress__indeterminate {
  stroke-dasharray: 0.3 1;
  animation: wavy-progress-scan 1.3s linear infinite;
}

@keyframes wavy-progress-scan {
  from {
    stroke-dashoffset: 0.34;
  }

  to {
    stroke-dashoffset: -1;
  }
}

:global(html[data-motion='reduced']) .wavy-linear-progress__wave,
:global(html[data-motion='none']) .wavy-linear-progress__wave {
  opacity: 0;
}

:global(html[data-motion='reduced']) .wavy-linear-progress__flat,
:global(html[data-motion='none']) .wavy-linear-progress__flat {
  opacity: 1;
}

:global(html[data-motion='none']) .wavy-linear-progress__indeterminate {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  :global(html[data-motion='system']) .wavy-linear-progress__wave {
    opacity: 0;
  }

  :global(html[data-motion='system']) .wavy-linear-progress__flat {
    opacity: 1;
  }

  .wavy-linear-progress__indeterminate {
    animation-duration: 2s;
  }
}
</style>
