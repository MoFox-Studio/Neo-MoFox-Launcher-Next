<script setup lang="ts">
// 关于面板：静态展示版本与技术栈信息。
</script>

<template>
  <section class="settings-group">
    <div class="settings-group__card">
      <div class="settings-group__heading">
        <span class="msr">info</span>
        <div>
          <h2>关于</h2>
          <p>版本与更新信息</p>
        </div>
      </div>
      <div class="settings-group__body">
        <div class="settings-item">
          <span class="msr settings-item__icon">info</span>
          <div class="settings-item__body">
            <span class="settings-item__label">Neo-MoFox Launcher</span>
            <span class="settings-item__desc">版本 0.1.0</span>
          </div>
          <button class="text-button state-layer">检查更新</button>
        </div>
        <div class="settings-item">
          <span class="msr settings-item__icon">description</span>
          <div class="settings-item__body">
            <span class="settings-item__desc">基于 Electron · Vue 3 · Material Design 3</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="./settings-panel.css"></style>
