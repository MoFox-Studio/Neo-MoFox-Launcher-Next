<script setup lang="ts">
/**
 * 无原生材质平台的 Mica 兜底罩层(纯展示,激活与否由 App 统一判定)。
 * 中性底色罩在裸透明窗口上,壁纸从余下透明度透出并被染上表面色;
 * 噪点独立成层置于前景之上,详见样式区说明。
 */
defineProps<{ active: boolean }>();
</script>

<template>
  <!-- 包装层不定位、不建层叠上下文,让两个子层直接参与 .shell 的层级排序。 -->
  <div v-if="active" aria-hidden="true">
    <div class="desktop-backdrop__tint"></div>
    <div class="desktop-backdrop__grain"></div>
  </div>
</template>

<style scoped>
/* 铺满含标题栏在内的整个窗口,与原生材质的覆盖范围保持一致。 */
.desktop-backdrop__tint {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: var(--app-mica-surface);
  pointer-events: none;
}

/*
 * 噪点若压在罩层内,会被 shell 表面(78%)衰减到不可感知;
 * 因此提到前景之上独立成层,低透明度只提供颗粒质感不影响可读性。
 * 弹窗(z-index 1000)与页面级浮层(30/40)位于其上,不受颗粒影响。
 */
.desktop-backdrop__grain {
  position: absolute;
  inset: 0;
  z-index: 2;
  background-image: var(--app-mica-noise);
  opacity: var(--app-mica-noise-opacity);
  pointer-events: none;
}
</style>
