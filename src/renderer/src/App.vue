<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppTitleBar from '@/components/AppTitleBar.vue';
import NavRail from '@/components/NavRail.vue';

const route = useRoute();
// OOBE runs full-bleed without navigation chrome.
const bare = computed(() => route.meta.bare === true);
</script>

<template>
  <div class="shell">
    <AppTitleBar />
    <div class="shell__body">
      <NavRail v-if="!bare" />
      <main class="shell__content" :class="{ 'shell__content--bare': bare }">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--md-sys-color-surface-container);
}

.shell__body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* Content pane sits on `surface` like an MD3 canvas inside the rail chrome. */
.shell__content {
  flex: 1;
  min-width: 0;
  background: var(--md-sys-color-surface);
  border-top-left-radius: var(--md-sys-shape-corner-extra-large);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.shell__content--bare {
  border-top-left-radius: 0;
}

/* MD3 emphasized page transition: fade through + slight upward settle. */
.page-enter-active {
  transition:
    opacity var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-emphasized-decelerate),
    transform var(--md-sys-motion-duration-medium2)
      var(--md-sys-motion-easing-emphasized-decelerate);
}

.page-leave-active {
  transition: opacity var(--md-sys-motion-duration-short2)
    var(--md-sys-motion-easing-emphasized-accelerate);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.page-leave-to {
  opacity: 0;
}
</style>
