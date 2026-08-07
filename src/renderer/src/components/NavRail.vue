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
    <ul class="rail__list">
      <li v-for="item in items" :key="item.name">
        <button
          class="rail__item state-layer"
          type="button"
          :class="{ 'rail__item--active': isActive(item) }"
          :aria-current="isActive(item) ? 'page' : undefined"
          @click="router.push({ name: item.name })"
        >
          <span class="msr rail__icon" :class="{ 'msr--fill': isActive(item) }" aria-hidden="true">
            {{ item.icon }}
          </span>
          <span class="rail__label">{{ item.label }}</span>
          <span
            v-if="item.name === 'install' && install.isInstalling"
            class="rail__badge"
            aria-label="正在安装"
          ></span>
        </button>
      </li>
    </ul>

    <button
      class="rail__primary state-layer"
      type="button"
      @click="router.push({ name: 'install' })"
    >
      <span class="msr" aria-hidden="true">add_circle</span>
      <span>新建实例</span>
    </button>
  </nav>
</template>

<style scoped>
/* 窗口内悬浮 Dock，不占据主内容布局高度。 */
.rail {
  position: absolute;
  left: 50%;
  bottom: 18px;
  z-index: 5;
  width: max-content;
  max-width: calc(100% - 32px);
  min-height: var(--app-navbar-height);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border: 1px solid var(--app-glass-highlight);
  border-radius: var(--md-sys-shape-corner-large);
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 68%, transparent);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.3),
    0 10px 30px rgb(20 18 24 / 0.16);
  backdrop-filter: blur(18px) saturate(145%);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
  transform: translateX(-50%);
}

.rail__list {
  min-width: 0;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.rail__item {
  position: relative;
  min-width: 68px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
}

.rail__item:active,
.rail__primary:active {
  transform: scale(0.97);
}

.rail__item--active {
  background: color-mix(in srgb, var(--md-sys-color-surface) 88%, transparent);
  color: var(--md-sys-color-primary);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.42),
    0 1px 5px rgb(20 18 24 / 0.06);
}

.rail__icon {
  font-size: 18px;
}

.rail__label,
.rail__primary {
  font: var(--md-sys-typescale-label-large);
}

.rail__badge {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 7px;
  height: 7px;
  border: 1px solid var(--md-sys-color-surface);
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-error);
}

.rail__primary {
  height: 38px;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  cursor: pointer;
  transition: transform var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
}

.rail__primary .msr {
  font-size: 18px;
}

@media (max-width: 960px) {
  .rail {
    gap: 6px;
    padding-inline: 8px;
  }

  .rail__item {
    min-width: 44px;
    padding-inline: 11px;
  }

  .rail__item:not(.rail__item--active) .rail__label {
    display: none;
  }

  .rail__primary span:last-child {
    display: none;
  }

  .rail__primary {
    width: 38px;
    padding: 0;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rail__item {
    transition:
      background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
      color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
  }

  .rail__primary {
    transition: none;
  }

  .rail__item:active,
  .rail__primary:active {
    transform: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .rail {
    background: var(--md-sys-color-surface-container);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
