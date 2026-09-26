<script setup lang="ts">
// 收藏实例部件：原概览页收藏区原样迁移，卡片交互与空状态保持不变。
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useInstancesStore } from '@/stores/instances';
import InstanceCard from '@/components/instance/InstanceCard.vue';
import HomeWidgetCard from './HomeWidgetCard.vue';

const router = useRouter();
const instancesStore = useInstancesStore();

const favoriteInstances = computed(() =>
  instancesStore.instances.filter((instance) => instance.extra?.isLike === true),
);
const totalCount = computed(() => favoriteInstances.value.length);
const hasAnyInstances = computed(() => instancesStore.instances.length > 0);

function onStart(id: string): void {
  void instancesStore.start(id);
}

function onStop(id: string): void {
  void instancesStore.stop(id);
}

function onRestart(id: string): void {
  void instancesStore.restart(id);
}

function openLogs(id: string): void {
  void router.push({ name: 'instance-logs', params: { id } });
}

function onManage(id: string): void {
  void router.push({ name: 'instance-manage', params: { id } });
}

function openInstances(): void {
  void router.push({ name: 'instances' });
}
</script>

<template>
  <HomeWidgetCard title="常用实例" icon="favorite">
    <template #actions>
      <button type="button" class="favorites-widget__link state-layer" @click="openInstances">
        查看全部
      </button>
    </template>

    <div v-if="!hasAnyInstances" class="favorites-widget__empty">
      <span class="favorites-widget__empty-mark" aria-hidden="true">
        <span class="msr">rocket_launch</span>
      </span>
      <h3>还没有实例</h3>
      <p>使用主导航中的添加按钮，开始安装或导入。</p>
    </div>

    <div v-else-if="totalCount === 0" class="favorites-widget__empty">
      <span class="favorites-widget__empty-mark" aria-hidden="true">
        <span class="msr">favorite_border</span>
      </span>
      <h3>收藏列表为空</h3>
      <p>在实例管理中收藏常用实例，它们就会固定在主页。</p>
      <button type="button" class="favorites-widget__link state-layer" @click="openInstances">
        前往实例列表
      </button>
    </div>

    <div v-else class="favorites-widget__grid">
      <InstanceCard
        v-for="instance in favoriteInstances"
        :key="instance.id"
        :instance="instance"
        @start="onStart"
        @stop="onStop"
        @restart="onRestart"
        @logs="openLogs"
        @manage="onManage"
      />
    </div>
  </HomeWidgetCard>
</template>

<style scoped>
.favorites-widget__link {
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.favorites-widget__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.favorites-widget__empty {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 28px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--app-glass-row);
  text-align: center;
}

.favorites-widget__empty-mark {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  margin-bottom: 6px;
  border-radius: 20px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.favorites-widget__empty-mark .msr {
  font-size: 30px;
}

.favorites-widget__empty h3,
.favorites-widget__empty p {
  margin: 0;
}

.favorites-widget__empty h3 {
  font: var(--md-sys-typescale-title-medium);
}

.favorites-widget__empty p {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}
</style>
