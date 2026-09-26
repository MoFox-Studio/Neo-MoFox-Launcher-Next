<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
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
function repaint(ids: string[]): void {
  if (!grid.value) return;
  const items = ids.flatMap(
    (id) => placements.value.find((entry) => entry.widget.id === id)?.widget ?? [],
  );
  for (const placement of placeWidgets(items)) {
    const element = Array.from(grid.value.children).find(
      (child) => (child as HTMLElement).dataset.id === placement.widget.id,
    ) as HTMLElement | undefined;
    if (element) Object.assign(element.style, placementStyle(placement));
  }
}
watch(
  [grid, () => props.editing],
  () => {
    sortable?.destroy();
    sortable = undefined;
    if (!grid.value || !props.editing) return;
    sortable = Sortable.create(grid.value, {
      draggable: '.widget-slot:not(.sortable-fallback)',
      handle: '.widget-slot__handle',
      animation: 150,
      ghostClass: 'widget-slot--ghost',
      forceFallback: true,
      fallbackOnBody: false,
      onStart(event) {
        original = placements.value.map((item) => item.widget.id);
        emit('select', event.item.dataset.id as HomeWidgetId);
      },
      onChange() {
        repaint(sortable!.toArray());
      },
      onEnd() {
        const ids = sortable!.toArray() as HomeWidgetId[];
        // Restore Vue-owned DOM before committing the new keyed order.
        sortable!.sort(original);
        repaint(original);
        emit('reorder', ids);
      },
    });
  },
  { flush: 'post' },
);
onBeforeUnmount(() => sortable?.destroy());
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
    <div ref="grid" class="home-grid">
      <div
        v-for="(placement, index) in placements"
        :key="placement.widget.id"
        class="widget-slot"
        :class="{ 'widget-slot--selected': editing && selected === placement.widget.id }"
        :data-id="placement.widget.id"
        :data-height="placement.widget.height"
        :style="placementStyle(placement)"
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
}
.widget-slot__content > :deep(*) {
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}
.widget-slot--selected {
  outline: 3px solid var(--md-sys-color-primary);
  outline-offset: -3px;
}
.widget-slot__toolbar {
  position: absolute;
  top: 6px;
  left: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 14px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  box-shadow: var(--md-sys-elevation-level1);
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
