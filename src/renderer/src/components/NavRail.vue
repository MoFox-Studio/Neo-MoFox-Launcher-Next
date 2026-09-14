<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAddInstanceStore } from '@/stores/add-instance';
import type { NavigationPosition, NavigationStyle } from '@shared/domain/settings';

const props = withDefaults(
  defineProps<{
    position?: NavigationPosition;
    variant?: NavigationStyle;
  }>(),
  {
    position: 'side',
    variant: 'standard',
  },
);

interface NavItem {
  name: string;
  label: string;
  icon: string;
  routes: string[];
}

const items: NavItem[] = [
  { name: 'dashboard', label: '概览', icon: 'space_dashboard', routes: ['dashboard'] },
  {
    name: 'instances',
    label: '实例',
    icon: 'deployed_code',
    routes: ['instances', 'instance-manage', 'instance-logs', 'install'],
  },
  { name: 'settings', label: '设置', icon: 'settings', routes: ['settings'] },
];

const route = useRoute();
const router = useRouter();
const addInstanceStore = useAddInstanceStore();
const listElement = ref<HTMLElement | null>(null);
const dragging = ref(false);
const tracking = ref(false);
const pointerId = ref<number | null>(null);
const dragStartCoordinate = ref(0);
const dragStartPosition = ref(0);
const visualPosition = ref(0);
const visualIndex = ref(0);
const panelOffset = ref(0);
const suppressClick = ref(false);

const activeIndex = computed(() => {
  const routeName = typeof route.name === 'string' ? route.name : '';
  const index = items.findIndex((item) => item.routes.includes(routeName));
  return index < 0 ? 0 : index;
});

const railStyle = computed(() => ({
  '--nav-position': visualPosition.value.toFixed(4),
  '--nav-count': String(items.length),
  '--nav-panel-offset': `${panelOffset.value}px`,
}));

watch(
  activeIndex,
  (index) => {
    if (dragging.value) return;
    visualIndex.value = index;
    visualPosition.value = index;
  },
  { immediate: true },
);

watch(
  () => props.position,
  () => {
    dragging.value = false;
    tracking.value = false;
    panelOffset.value = 0;
    visualIndex.value = activeIndex.value;
    visualPosition.value = activeIndex.value;
  },
);

function isActive(item: NavItem): boolean {
  return item.routes.includes(typeof route.name === 'string' ? route.name : '');
}

function pointerCoordinate(event: globalThis.PointerEvent): number {
  return props.position === 'bottom' ? event.clientX : event.clientY;
}

function itemExtent(): number {
  if (!listElement.value) return 1;
  const bounds = listElement.value.getBoundingClientRect();
  const length = props.position === 'bottom' ? bounds.width : bounds.height;
  return Math.max(1, (length - 10) / items.length);
}

function indexFromTarget(target: EventTarget | null): number | null {
  if (!(target instanceof globalThis.Element)) return null;
  const button = target.closest<HTMLElement>('[data-nav-index]');
  if (!button || !listElement.value?.contains(button)) return null;
  const index = Number(button.dataset.navIndex);
  return Number.isInteger(index) ? index : null;
}

function updateDrag(event: globalThis.PointerEvent): void {
  const extent = itemExtent();
  const rawPosition =
    dragStartPosition.value + (pointerCoordinate(event) - dragStartCoordinate.value) / extent;
  const clampedPosition = Math.max(0, Math.min(items.length - 1, rawPosition));
  const overDrag = rawPosition - clampedPosition;

  if (Math.abs(pointerCoordinate(event) - dragStartCoordinate.value) > 3) tracking.value = true;
  visualPosition.value = clampedPosition;
  visualIndex.value = Math.round(clampedPosition);
  panelOffset.value = Math.sign(overDrag) * Math.min(4, Math.abs(overDrag) * extent * 0.12);
}

function onPointerDown(event: globalThis.PointerEvent): void {
  if (props.variant !== 'floating') return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const index = indexFromTarget(event.target);
  if (index === null || !listElement.value) return;

  pointerId.value = event.pointerId;
  dragging.value = true;
  tracking.value = false;
  dragStartCoordinate.value = pointerCoordinate(event);
  dragStartPosition.value = index;
  visualPosition.value = index;
  visualIndex.value = index;
  panelOffset.value = 0;
  listElement.value.setPointerCapture(event.pointerId);
}

function onPointerMove(event: globalThis.PointerEvent): void {
  if (!dragging.value || pointerId.value !== event.pointerId) return;
  updateDrag(event);
}

async function activateIndex(index: number): Promise<void> {
  visualIndex.value = index;
  visualPosition.value = index;
  if (activeIndex.value === index) return;

  try {
    await router.push({ name: items[index].name });
  } finally {
    if (activeIndex.value !== index) {
      visualIndex.value = activeIndex.value;
      visualPosition.value = activeIndex.value;
    }
  }
}

function releasePointerCapture(event: globalThis.PointerEvent): void {
  if (listElement.value?.hasPointerCapture(event.pointerId)) {
    listElement.value.releasePointerCapture(event.pointerId);
  }
  pointerId.value = null;
}

function onPointerUp(event: globalThis.PointerEvent): void {
  if (!dragging.value || pointerId.value !== event.pointerId) return;
  updateDrag(event);
  releasePointerCapture(event);

  const targetIndex = visualIndex.value;
  dragging.value = false;
  tracking.value = false;
  panelOffset.value = 0;
  visualPosition.value = targetIndex;

  // Pointer 与键盘激活走不同路径；这里先消费随后产生的 click，避免重复导航。
  suppressClick.value = true;
  void activateIndex(targetIndex);
  window.setTimeout(() => {
    suppressClick.value = false;
  });
}

function onPointerCancel(event: globalThis.PointerEvent): void {
  if (pointerId.value !== event.pointerId) return;
  releasePointerCapture(event);
  dragging.value = false;
  tracking.value = false;
  panelOffset.value = 0;
  visualIndex.value = activeIndex.value;
  visualPosition.value = activeIndex.value;
}

function onItemClick(index: number): void {
  if (suppressClick.value) return;
  void activateIndex(index);
}
</script>

<template>
  <nav
    class="rail"
    :class="[
      `rail--${props.position}`,
      `rail--${props.variant}`,
      { 'rail--dragging': dragging, 'rail--tracking': tracking },
    ]"
    :style="railStyle"
    aria-label="主导航"
  >
    <button
      class="rail__fab state-layer"
      type="button"
      title="添加实例"
      aria-label="添加实例"
      @click="addInstanceStore.show()"
    >
      <span class="msr" aria-hidden="true">add</span>
    </button>

    <ul
      ref="listElement"
      class="rail__list"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
    >
      <li class="rail__selection" aria-hidden="true"></li>
      <li v-for="(item, index) in items" :key="item.name">
        <button
          class="rail__item state-layer"
          type="button"
          :data-nav-index="index"
          :class="{
            'rail__item--active': isActive(item),
            'rail__item--visual-active': visualIndex === index,
          }"
          :aria-current="isActive(item) ? 'page' : undefined"
          @click="onItemClick(index)"
        >
          <span class="rail__indicator">
            <span class="msr" :class="{ 'msr--fill': visualIndex === index }" aria-hidden="true">
              {{ item.icon }}
            </span>
          </span>
          <span class="rail__label">{{ item.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.rail {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  color: var(--md-sys-color-on-surface);
}

.rail--standard {
  background: var(--app-shell-chrome-surface);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.rail--side {
  flex-direction: column;
}

.rail--side.rail--standard {
  width: 100%;
  height: 100%;
  gap: 20px;
  padding: 8px 0 20px;
  border-right: 1px solid var(--app-glass-border);
}

.rail--bottom {
  flex-direction: row;
}

.rail--bottom.rail--standard {
  width: 100%;
  height: 100%;
  gap: 12px;
  padding: 6px 18px;
  border-top: 1px solid var(--app-glass-border);
}

/*
 * 悬浮模式由两个独立表面组成：快捷按钮与导航胶囊。外层本身完全透明，
 * 不再用一条铺满窗口边缘的 rail 冒充悬浮导航。
 */
.rail--floating {
  --dock-press-scale: 1;

  flex: 0 0 auto;
  gap: 10px;
  background: transparent;
  transform: translate3d(0, var(--nav-panel-offset), 0) scaleY(var(--dock-press-scale));
  transform-origin: center;
  transition: transform var(--app-motion-duration-spatial) var(--app-motion-easing-spring);
}

.rail--bottom.rail--floating {
  transform: translate3d(var(--nav-panel-offset), 0, 0) scaleX(var(--dock-press-scale));
}

.rail--floating.rail--dragging {
  --dock-press-scale: var(--app-motion-dock-press-scale);
}

.rail__fab {
  width: 56px;
  height: 56px;
  flex: 0 0 56px;
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
    transform var(--app-motion-duration-press) var(--app-motion-easing-spring);
}

.rail--floating .rail__fab {
  border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 56%, transparent);
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-surface-container-high) 88%, transparent);
  box-shadow:
    0 6px 18px rgb(0 0 0 / 0.14),
    inset 0 1px 0 color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
  backdrop-filter: blur(18px) saturate(1.16);
  -webkit-backdrop-filter: blur(18px) saturate(1.16);
}

.rail__fab:hover {
  background: var(--md-sys-color-primary-container);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.16);
  transform: scale(var(--app-motion-control-hover-scale));
}

.rail__fab:active {
  transform: scale(var(--app-motion-control-press-scale));
}

.rail__list {
  position: relative;
  list-style: none;
  margin: 0;
  display: grid;
  touch-action: none;
}

.rail--side.rail--standard .rail__list {
  width: 100%;
  padding: 0 8px;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr);
}

.rail--bottom.rail--standard .rail__list {
  width: min(520px, 100%);
  flex: 1;
  grid-template-columns: repeat(3, minmax(76px, 128px));
  justify-content: center;
  padding: 0;
}

.rail--floating .rail__list {
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 58%, transparent);
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 86%, transparent);
  box-shadow:
    0 8px 24px rgb(0 0 0 / 0.14),
    inset 0 1px 0 color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
  backdrop-filter: blur(18px) saturate(1.16);
  -webkit-backdrop-filter: blur(18px) saturate(1.16);
  overflow: hidden;
}

.rail--side.rail--floating .rail__list {
  width: 74px;
  grid-template-rows: repeat(3, 64px);
}

.rail--bottom.rail--floating .rail__list {
  height: 66px;
  grid-template-columns: repeat(3, 80px);
}

.rail__list > li:not(.rail__selection) {
  position: relative;
  z-index: 1;
  min-width: 0;
  min-height: 0;
}

.rail__selection {
  display: none;
  position: absolute;
  z-index: 0;
  pointer-events: none;
  border: 1px solid color-mix(in srgb, var(--md-sys-color-primary) 18%, transparent);
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-primary) 16%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--md-sys-color-on-primary-container) 12%, transparent),
    0 2px 8px color-mix(in srgb, var(--md-sys-color-primary) 10%, transparent);
  transition:
    transform var(--app-motion-duration-spatial) var(--app-motion-easing-spring),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.rail--floating .rail__selection {
  display: block;
}

.rail--side.rail--floating .rail__selection {
  top: 5px;
  left: 5px;
  width: 64px;
  height: 64px;
  transform: translate3d(0, calc(var(--nav-position) * 100%), 0);
}

.rail--bottom.rail--floating .rail__selection {
  top: 5px;
  left: 5px;
  width: 80px;
  height: 56px;
  transform: translate3d(calc(var(--nav-position) * 100%), 0, 0);
}

.rail--tracking .rail__selection {
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.rail__item {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: var(--app-density-row-min-height);
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
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--app-motion-duration-press) var(--app-motion-easing-spring);
}

.rail--floating .rail__item {
  min-height: 0;
  padding: 4px;
  border-radius: var(--md-sys-shape-corner-full);
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
  transition: transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.rail__item:hover {
  background: var(--md-sys-color-surface-container-highest);
}

.rail--floating .rail__item:hover {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
}

.rail--floating .rail__item:active {
  transform: scale(var(--app-motion-control-press-scale));
}

.rail__indicator {
  position: relative;
  width: 56px;
  height: 24px;
  border-radius: var(--md-sys-shape-corner-full);
  display: grid;
  place-items: center;
}

.rail__indicator .msr {
  transition: transform var(--app-motion-duration-spatial) var(--app-motion-easing-spring);
}

.rail__item--active {
  color: var(--md-sys-color-on-secondary-container);
}

.rail__item--active .rail__indicator {
  background: var(--md-sys-color-secondary-container);
}

.rail__item--active::before {
  transform: translateY(-50%) scaleY(1);
}

.rail--floating .rail__item--active .rail__indicator,
.rail--floating .rail__item--visual-active .rail__indicator {
  background: transparent;
}

.rail--floating .rail__item--visual-active {
  color: var(--md-sys-color-primary);
}

.rail--floating .rail__item--visual-active .rail__indicator .msr {
  transform: scale(var(--app-motion-icon-selected-scale));
}

.rail--floating .rail__item::before {
  display: none;
}

.rail__label {
  font: var(--md-sys-typescale-label-medium);
}

.rail--bottom.rail--standard .rail__fab {
  width: 48px;
  height: 48px;
  flex-basis: 48px;
}

.rail--bottom.rail--standard .rail__item {
  min-height: 52px;
  padding: 4px 8px;
}

.rail--bottom.rail--standard .rail__item::before {
  top: auto;
  right: 18px;
  bottom: -1px;
  left: 18px;
  width: auto;
  height: 3px;
  border-radius: 2px 2px 0 0;
  transform: scaleX(0);
}

.rail--bottom.rail--standard .rail__item--active::before {
  transform: scaleX(1);
}

@media (prefers-reduced-motion: reduce) {
  .rail--floating,
  .rail__selection,
  .rail__indicator .msr {
    transition-duration: var(--md-sys-motion-duration-short2);
    transition-timing-function: var(--md-sys-motion-easing-standard);
  }

  .rail__fab:hover,
  .rail__fab:active,
  .rail--floating .rail__item:active,
  .rail--floating .rail__item--visual-active .rail__indicator .msr {
    transform: none;
  }
}
</style>
