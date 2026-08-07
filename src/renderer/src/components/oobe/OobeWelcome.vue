<script setup lang="ts">
const version = '0.1.0';

const emit = defineEmits<{ (e: 'next'): void }>();
</script>

<template>
  <section class="oobe-step oobe-step--welcome">
    <div class="oobe__hero">
      <img class="oobe__hero-logo" src="/logo.png" alt="Neo-MoFox" />
    </div>
    <h1 class="oobe__title">欢迎使用 Neo-MoFox</h1>
    <p class="oobe__intro">
      Neo-MoFox Launcher 帮助你快速安装、配置与管理机器人实例。 接下来的几步将安装运行所需依赖、检测旧版数据并设置基础偏好，整个过程只需几分钟。
    </p>
    <p class="oobe__version">版本 {{ version }}</p>
    <button type="button" class="btn btn--filled btn--large state-layer" @click="emit('next')">
      开始
    </button>
  </section>
</template>

<style scoped>
.oobe-step--welcome {
  align-items: center;
  text-align: center;
  gap: 8px;
}

.oobe__hero {
  width: 160px;
  height: 160px;
  display: grid;
  place-items: center;
  margin-bottom: 32px;
}

.oobe__hero-logo {
  width: 136px;
  height: 136px;
  object-fit: contain;
}

.oobe__title {
  font: var(--md-sys-typescale-display-small);
  margin: 0 0 16px;
}

.oobe__intro {
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
  max-width: 440px;
  margin: 0 0 16px;
}

.oobe__version {
  font: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 32px;
}

.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  overflow: hidden;
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--large {
  height: 56px;
  padding: 0 32px;
  font: var(--md-sys-typescale-title-medium);
}
</style>
