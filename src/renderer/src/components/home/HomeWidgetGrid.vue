<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Sortable from 'sortablejs';
import type { HomeWidgetId, HomeWidgetState } from '@shared/domain/home';
import { HOME_WIDGET_DEFINITIONS } from './registry';
import { useHomeGeometryStore } from '@/stores/home-geometry';
import { placeWidgets, placementStyle, type HomeGeometry } from '@/utils/home-layout';

const props = defineProps<{
  widgets: HomeWidgetState[];
  geometry?: HomeGeometry;
  editing?: boolean;
  selected?: HomeWidgetId;
}>();
const emit = defineEmits<{ select: [id: HomeWidgetId]; reorder: [ids: HomeWidgetId[]] }>();
const store = useHomeGeometryStore();
const grid = ref<HTMLElement>();
const placements = computed(() =>
  placeWidgets(
    props.widgets
      .filter((widget) => widget.enabled)
      .map((state) => ({
        id: state.id,
        state,
        definition: HOME_WIDGET_DEFINITIONS.find((item) => item.id === state.id)!,
        ...(props.geometry ?? store.geometry)[state.id]!,
      })),
  ),
);
let sortable: Sortable | undefined;
let original: string[] = [];
let cancelRequested = false;
const dragging = ref<HomeWidgetId | null>(null);
const previewOrder = ref<string[] | null>(null);
const previewStyles = computed(() => {
  if (!previewOrder.value) return new Map();
  const byId = new Map(placements.value.map((entry) => [entry.widget.id as string, entry.widget]));
  return new Map(
    placeWidgets(previewOrder.value.flatMap((id) => byId.get(id) ?? [])).map((entry) => [
      entry.widget.id,
      placementStyle(entry),
    ]),
  );
});
const dragAnnouncement = ref('');
const animations = new Map<HTMLElement, ReturnType<HTMLElement['animate']>>();
function tiles(): HTMLElement[] {
  return Array.from(grid.value?.children ?? []).filter(
    (child) => !child.classList.contains('sortable-fallback'),
  ) as HTMLElement[];
}
function repaint(ids: string[], animate = false): void {
  const elements = tiles();
  const previous = new Map(elements.map((element) => [element, element.getBoundingClientRect()]));
  animations.forEach((animation) => animation.cancel());
  animations.clear();
  const items = ids.flatMap(
    (id) => placements.value.find((entry) => entry.widget.id === id)?.widget ?? [],
  );
  for (const placement of placeWidgets(items)) {
    const element = elements.find((child) => child.dataset.id === placement.widget.id);
    if (element) Object.assign(element.style, placementStyle(placement));
  }
  if (animate) animateLayout(previous);
}
function animateLayout(
  previous: Map<HTMLElement, ReturnType<HTMLElement['getBoundingClientRect']>>,
): void {
  const theme = window.getComputedStyle(document.documentElement);
  const durationValue = theme.getPropertyValue('--app-motion-duration-spatial').trim();
  const duration = parseFloat(durationValue) * (durationValue.endsWith('ms') ? 1 : 1000);
  if (!duration || duration <= 1) return;
  const easing = theme.getPropertyValue('--app-motion-easing-spatial').trim() || 'ease-out';
  for (const element of tiles()) {
    if (element.dataset.id === dragging.value) continue;
    const before = previous.get(element);
    const after = element.getBoundingClientRect();
    const frames = before
      ? [
          {
            transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)`,
            height: `${before.height}px`,
            width: `${before.width}px`,
          },
          { transform: 'translate(0, 0)', height: `${after.height}px`, width: `${after.width}px` },
        ]
      : [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ];
    if (
      before &&
      before.left === after.left &&
      before.top === after.top &&
      before.height === after.height &&
      before.width === after.width
    )
      continue;
    const animation = element.animate(frames, { duration, easing });
    animations.set(element, animation);
    animation.onfinish = () => {
      if (animations.get(element) === animation) animations.delete(element);
    };
  }
}
watch(
  () => placements.value.map((entry) => [entry.widget.id, placementStyle(entry)]),
  async () => {
    if (dragging.value || !grid.value) return;
    const previous = new Map(tiles().map((element) => [element, element.getBoundingClientRect()]));
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    await nextTick();
    if (grid.value && !dragging.value) animateLayout(previous);
  },
);

function initializeSortable(): void {
  sortable?.destroy();
  sortable = undefined;
  if (!grid.value || !props.editing) return;
  sortable = Sortable.create(grid.value, {
    draggable: '.widget-slot:not(.sortable-fallback)',
    handle: '.widget-slot__handle',
    animation: 0,
    ghostClass: 'widget-slot--ghost',
    forceFallback: true,
    fallbackOnBody: false,
    fallbackTolerance: 4,
    scrollSensitivity: 70,
    scrollSpeed: 12,
    direction(_event, target, dragged) {
      if (!target || !dragged) return 'vertical';
      return target.style.gridColumn === dragged.style.gridColumn ? 'vertical' : 'horizontal';
    },
    onStart(event) {
      cancelRequested = false;
      original = placements.value.map((item) => item.widget.id);
      previewOrder.value = original;
      dragging.value = event.item.dataset.id as HomeWidgetId;
      emit('select', dragging.value);
      dragAnnouncement.value = '正在移动组件，其他组件会自动让位。按 Esc 撤销。';
    },
    onChange() {
      const ids = sortable!.toArray();
      previewOrder.value = ids;
      repaint(ids, true);
      dragAnnouncement.value = `放置位置：第 ${ids.indexOf(dragging.value!) + 1} 个，共 ${ids.length} 个组件`;
    },
    onEnd(event) {
      const originalEvent = (event as Sortable.SortableEvent & { originalEvent?: Event })
        .originalEvent;
      const cancelled =
        cancelRequested ||
        originalEvent?.type === 'pointercancel' ||
        originalEvent?.type === 'touchcancel';
      const ids = cancelled ? original : sortable!.toArray();
      sortable!.sort(original);
      repaint(ids);
      previewOrder.value = null;
      dragging.value = null;
      emit('reorder', ids as HomeWidgetId[]);
      dragAnnouncement.value = cancelled ? '已撤销本次移动' : '组件已放置，保存布局后生效';
    },
  });
}
function cancelDrag(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !dragging.value || !sortable) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cancelRequested = true;
  // Destroy through the public API so Sortable releases its mouse/touch handlers.
  sortable.destroy();
  sortable = undefined;
  const elements = tiles();
  for (const id of original) {
    const element = elements.find((tile) => tile.dataset.id === id);
    if (element) grid.value?.appendChild(element);
  }
  repaint(original);
  previewOrder.value = null;
  dragging.value = null;
  dragAnnouncement.value = '已撤销本次移动';
  void nextTick(initializeSortable);
}
watch([grid, () => props.editing], initializeSortable, { flush: 'post' });
document.addEventListener('keydown', cancelDrag, true);
onBeforeUnmount(() => {
  document.removeEventListener('keydown', cancelDrag, true);
  sortable?.destroy();
  animations.forEach((animation) => animation.cancel());
});
function move(id: HomeWidgetId, direction: number): void {
  const ids = placements.value.map((entry) => entry.widget.id);
  const index = ids.indexOf(id);
  const target = index + direction;
  if (target < 0 || target >= ids.length) return;
  ids.splice(index, 1);
  ids.splice(target, 0, id);
  emit('reorder', ids);
}
</script>

<template>
  <div class="home-grid-container" :class="{ 'home-grid-container--editing': editing }">
    <p v-if="editing" class="drag-status" role="status" aria-live="polite">
      {{ dragAnnouncement || '拖住标题移动组件，箭头按钮也可调整顺序。' }}
    </p>
    <div ref="grid" class="home-grid" :class="{ 'home-grid--dragging': dragging }">
      <div
        v-for="(placement, index) in placements"
        :key="placement.widget.id"
        class="widget-slot"
        :class="{ 'widget-slot--selected': editing && selected === placement.widget.id }"
        :data-id="placement.widget.id"
        :data-height="placement.widget.height"
        :style="previewStyles.get(placement.widget.id) ?? placementStyle(placement)"
        @click="editing && emit('select', placement.widget.id)"
      >
        <div class="widget-slot__content" :inert="editing ? true : undefined">
          <component
            :is="placement.widget.definition.component"
            :config="placement.widget.state.config"
          />
        </div>
        <div v-if="editing" class="widget-slot__toolbar">
          <button
            type="button"
            class="widget-slot__handle"
            :aria-label="`选择并拖动${placement.widget.definition.title}`"
            @click="emit('select', placement.widget.id)"
          >
            <span class="msr" aria-hidden="true">drag_indicator</span
            >{{ placement.widget.definition.title }}
          </button>
          <button
            type="button"
            :disabled="index === 0"
            :aria-label="`前移${placement.widget.definition.title}`"
            @click.stop="move(placement.widget.id, -1)"
          >
            <span class="msr">arrow_upward</span>
          </button>
          <button
            type="button"
            :disabled="index === placements.length - 1"
            :aria-label="`后移${placement.widget.definition.title}`"
            @click.stop="move(placement.widget.id, 1)"
          >
            <span class="msr">arrow_downward</span>
          </button>
        </div>
      </div>
    </div>
    <p v-if="placements.length === 0" class="home-grid__empty">
      尚未显示小组件，请在布局编辑器左侧开启。
    </p>
  </div>
</template>

<style src="./home-widgets.css"></style>
<style scoped>
.home-grid-container {
  container-type: inline-size;
  min-width: 0;
}
.home-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: 1px;
  column-gap: 16px;
}
.widget-slot {
  min-width: 0;
  min-height: 0;
  position: relative;
  height: var(--widget-height);
  border-radius: 24px;
}
.widget-slot__content {
  height: 100%;
  min-width: 0;
  container: widget / size;
}
.widget-slot__content > :deep(*) {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}
.widget-slot--selected {
  box-shadow: 0 0 0 2px var(--md-sys-color-primary);
}
.widget-slot__toolbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 20px 20px 0 0;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-secondary-container);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
}
.home-grid-container--editing .widget-slot {
  padding-top: 37px;
  box-sizing: border-box;
  background: var(--md-sys-color-surface-container);
  overflow: hidden;
  transition: box-shadow var(--app-motion-duration-spatial) ease;
}
.home-grid-container--editing .widget-slot__content {
  height: 100%;
}
.widget-slot--selected .widget-slot__toolbar {
  background: var(--md-sys-color-secondary-container);
}
.widget-slot__toolbar button:hover:not(:disabled) {
  background: var(--md-sys-color-secondary-container);
}
.widget-slot__toolbar button {
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  min-height: 30px;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.widget-slot__toolbar button:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: -3px;
}
.widget-slot__toolbar button:disabled {
  opacity: 0.3;
}
.widget-slot__handle {
  flex: 1;
  min-width: 0;
  text-align: left;
  cursor: grab !important;
  touch-action: none;
}
.drag-status {
  margin: 0 0 12px;
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}
.home-grid--dragging {
  user-select: none;
}
.sortable-fallback {
  z-index: 10;
  opacity: 0.92;
  box-shadow: var(--md-sys-elevation-level3);
  pointer-events: none;
}
.widget-slot--ghost {
  opacity: 0.35;
}
.home-grid__empty {
  padding: 48px 20px;
  text-align: center;
}
@container (max-width: 560px) {
  .home-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .widget-slot {
    flex: none;
  }
}
</style>
