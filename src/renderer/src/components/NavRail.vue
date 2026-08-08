<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { useInstallStore } from '@/stores/install';

// 主导航：路由驱动选中态，并显示后台安装任务提示。
interface NavItem {
  name: string;
  label: string;
  icon: string;
}

const items: NavItem[] = [
  { name: 'dashboard', label: '概览', icon: 'space_dashboard' },
  { name: 'instances', label: '实例', icon: 'deployed_code' },
  { name: 'install', label: '安装', icon: 'download' },
  { name: 'settings', label: '设置', icon: 'settings' },
];

// 当前路由和安装仓库共同决定导航的动态视觉状态。
const route = useRoute();
const router = useRouter();
const install = useInstallStore();

function isActive(item: NavItem): boolean {
  return route.name === item.name;
}
</script>

<template>
  <nav class="rail" aria-label="主导航">
    <!-- 快捷创建入口 -->
    <button
      class="rail__fab state-layer"
      type="button"
      title="新建实例"
      @click="router.push({ name: 'install' })"
    >
      <span class="msr" aria-hidden="true">add</span>
    </button>

    <!-- 路由导航项与安装中徽标 -->
    <ul class="rail__list">
      <li v-for="item in items" :key="item.name">
        <button
          class="rail__item"
          type="button"
          :class="{ 'rail__item--active': isActive(item) }"
          :aria-current="isActive(item) ? 'page' : undefined"
          @click="router.push({ name: item.name })"
        >
          <span class="rail__indicator state-layer">
            <span class="msr" :class="{ 'msr--fill': isActive(item) }" aria-hidden="true">
              {{ item.icon }}
            </span>
            <span
              v-if="item.name === 'install' && install.isInstalling"
              class="rail__badge"
              aria-label="正在安装"
            ></span>
          </span>
          <span class="rail__label">{{ item.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
/* 导航栏、快捷入口和选中态 */
.rail {
  width: var(--app-navrail-width);
  flex: 0 0 var(--app-navrail-width);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 8px 0 20px;
  border-right: 1px solid var(--app-glass-border);
  background: var(--md-sys-color-surface);
  background: var(--app-glass-surface);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
  z-index: 5;
}

.rail__fab {
  width: 56px;
  height: 56px;
  border: none;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-primary);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.rail__fab:hover {
  background: var(--md-sys-color-primary-container);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  transform: scale(1.02);
}

.rail__fab:active {
  transform: scale(0.98);
}

.rail__list {
  width: 100%;
  list-style: none;
  margin: 0;
  padding: 0 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rail__item {
  position: relative;
  width: 100%;
  min-height: 56px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: none;
  border-radius: var(--md-sys-shape-corner-large);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  overflow: hidden;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.rail__item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 32px;
  border-radius: 0 2px 2px 0;
  background: var(--md-sys-color-primary);
  transform: translateY(-50%) scaleY(0);
  transform-origin: center;
  transition: transform var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.rail__item:hover {
  background: var(--md-sys-color-surface-container-highest);
}

.rail__indicator {
  position: relative;
  width: 56px;
  height: 24px;
  border-radius: var(--md-sys-shape-corner-full);
  display: grid;
  place-items: center;
}

.rail__item--active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.rail__item--active::before {
  transform: translateY(-50%) scaleY(1);
}

.rail__badge {
  position: absolute;
  top: 0;
  right: 10px;
  width: 8px;
  height: 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-error);
}

.rail__label {
  font: var(--md-sys-typescale-label-medium);
}
</style>
