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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  padding: 8px 0 20px;
}

.rail__fab {
  width: 56px;
  height: 56px;
  border: none;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  box-shadow: var(--md-sys-elevation-level1);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.rail__fab:hover {
  box-shadow: var(--md-sys-elevation-level2);
}

.rail__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rail__item {
  width: var(--app-navrail-width);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}

.rail__indicator {
  position: relative;
  width: 56px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  display: grid;
  place-items: center;
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.rail__item--active {
  color: var(--md-sys-color-on-surface);
}

.rail__item--active .rail__indicator {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.rail__badge {
  position: absolute;
  top: 4px;
  right: 12px;
  width: 8px;
  height: 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-error);
}

.rail__label {
  font: var(--md-sys-typescale-label-medium);
}
</style>
