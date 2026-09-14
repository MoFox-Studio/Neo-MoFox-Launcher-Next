<script setup lang="ts">
import { computed, nextTick, ref, useSlots, watch } from 'vue';

export interface TaskPhase {
  id: string;
  label: string;
  icon: string;
}

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle: string;
    icon: string;
    phases?: TaskPhase[];
    activePhase?: string;
    navigable?: boolean;
    showFooter?: boolean;
  }>(),
  {
    phases: () => [],
    activePhase: '',
    navigable: false,
    showFooter: true,
  },
);

const emit = defineEmits<{
  selectPhase: [id: string];
}>();

const slots = useSlots();
const bodyRef = ref<HTMLElement | null>(null);
const activeIndex = computed(() =>
  Math.max(
    0,
    props.phases.findIndex((phase) => phase.id === props.activePhase),
  ),
);

function canSelect(index: number): boolean {
  return props.navigable && index < activeIndex.value;
}

watch(
  () => props.activePhase,
  async () => {
    await nextTick();
    bodyRef.value?.scrollTo({ top: 0 });
  },
);
</script>

<template>
  <div class="task-stage">
    <section class="task-surface">
      <header class="task-surface__header">
        <div class="task-identity">
          <span class="task-identity__mark" aria-hidden="true">
            <span class="msr msr--fill">{{ icon }}</span>
          </span>
          <div class="task-identity__copy">
            <div class="task-identity__title-row">
              <h1>{{ title }}</h1>
              <slot name="badge"></slot>
            </div>
            <p>{{ subtitle }}</p>
          </div>
        </div>

        <nav
          v-if="phases.length"
          class="task-phases"
          aria-label="任务进度"
          :style="{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))` }"
        >
          <button
            v-for="(phase, index) in phases"
            :key="phase.id"
            type="button"
            class="task-phase state-layer"
            :class="{
              'task-phase--active': phase.id === activePhase,
              'task-phase--done': index < activeIndex,
            }"
            :disabled="!canSelect(index)"
            :aria-current="phase.id === activePhase ? 'step' : undefined"
            @click="emit('selectPhase', phase.id)"
          >
            <span class="task-phase__marker" aria-hidden="true">
              <span class="msr">{{ index < activeIndex ? 'check' : phase.icon }}</span>
            </span>
            <span class="task-phase__label">{{ phase.label }}</span>
          </button>
        </nav>
      </header>

      <div ref="bodyRef" class="task-surface__body">
        <slot></slot>
      </div>

      <footer
        v-if="showFooter && (slots['leading-actions'] || slots.actions)"
        class="task-surface__footer"
      >
        <div class="task-surface__leading-actions">
          <slot name="leading-actions"></slot>
        </div>
        <div class="task-surface__actions">
          <slot name="actions"></slot>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.task-stage {
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 32px calc(24px + var(--app-nav-overlay-bottom-inset))
    calc(32px + var(--app-nav-overlay-start-inset));
  overflow: hidden;
}

.task-surface {
  width: min(100%, 880px);
  height: min(100%, 760px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-low);
  box-shadow: var(--md-sys-elevation-level1);
}

.task-surface__header {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px 28px 18px;
}

.task-identity {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.task-identity__mark {
  flex: none;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.task-identity__mark .msr {
  font-size: 30px;
}

.task-identity__copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.task-identity__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.task-identity h1,
.task-identity p {
  margin: 0;
}

.task-identity h1 {
  overflow: hidden;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-headline-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-identity p {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.task-phases {
  display: grid;
  gap: 3px;
}

.task-phase {
  min-width: 0;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  border: 0;
  border-radius: 6px;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: default;
  transition:
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.task-phase:first-child {
  border-radius: 16px 6px 6px 16px;
}

.task-phase:last-child {
  border-radius: 6px 16px 16px 6px;
}

.task-phase:not(:disabled) {
  cursor: pointer;
}

.task-phase--active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.task-phase--done {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.task-phase__marker {
  flex: none;
  display: grid;
  place-items: center;
}

.task-phase__marker .msr {
  font-size: 18px;
}

.task-phase__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-surface__body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 8px 28px 28px;
}

.task-surface__footer {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 72px;
  padding: 12px 28px 16px;
  background: var(--md-sys-color-surface-container-low);
}

.task-surface__leading-actions,
.task-surface__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-surface__actions {
  justify-content: flex-end;
}

@media (max-width: 720px) {
  .task-stage {
    align-items: stretch;
    padding: 12px 12px calc(12px + var(--app-nav-overlay-bottom-inset))
      calc(12px + var(--app-nav-overlay-start-inset));
  }

  .task-surface {
    height: 100%;
    border-radius: 22px;
  }

  .task-surface__header {
    gap: 14px;
    padding: 18px 18px 12px;
  }

  .task-identity__mark {
    width: 48px;
    height: 48px;
    border-radius: 15px;
  }

  .task-identity h1 {
    font: var(--md-sys-typescale-title-large);
  }

  .task-phase {
    min-height: 38px;
    padding: 6px;
  }

  .task-phase__label {
    display: none;
  }

  .task-surface__body {
    padding: 6px 18px 20px;
  }

  .task-surface__footer {
    min-height: 64px;
    padding: 10px 18px 14px;
  }
}
</style>
