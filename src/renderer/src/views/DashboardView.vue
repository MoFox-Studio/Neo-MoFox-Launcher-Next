<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import PageHeader from '@/components/PageHeader.vue';
import InstanceCard from '@/components/InstanceCard.vue';

// 概览页聚合实例运行数据，并将卡片交互委派给实例仓库或路由。
const router = useRouter();
const instancesStore = useInstancesStore();

// 随当前时段生成问候语，统计值始终从响应式实例列表派生。
const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，注意休息';
  if (hour < 12) return '早上好，开始新的一天';
  if (hour < 18) return '下午好，运行状态一切正常';
  return '晚上好，来看看今天的实例情况';
});

const totalCount = computed(() => instancesStore.instances.length);
const runningCount = computed(() => instancesStore.running.length);
const platformCount = computed(
  () => new Set(instancesStore.instances.map((i) => i.platformId)).size,
);

// 页面进入时发起列表同步，卡片状态后续由仓库事件更新。
onMounted(() => {
  instancesStore.refresh();
});

function onStart(id: string): void {
  instancesStore.start(id);
}

function onStop(id: string): void {
  instancesStore.stop(id);
}

function onRestart(id: string): void {
  instancesStore.restart(id);
}

function onRemove(id: string): void {
  instancesStore.remove(id);
}

function onOpenFolder(id: string): void {
  mofoxApi.openInstanceFolder(id);
}

function onLogs(id: string): void {
  router.push({ name: 'instance-logs', params: { id } });
}

function goInstall(): void {
  router.push({ name: 'install' });
}
</script>

<template>
  <div class="dashboard">
    <!-- 页面标题、实例汇总与快捷统计 -->
    <PageHeader title="概览" :subtitle="greeting" />

    <div class="dashboard__body">
      <section class="hero">
        <div class="hero__count">
          <span class="hero__count-main">{{ runningCount }}</span>
          <span class="hero__count-sep">/</span>
          <span class="hero__count-total">{{ totalCount }}</span>
          <span class="hero__count-label">实例运行中</span>
        </div>

        <div class="hero__stats">
          <div class="hero__stat-card">
            <span class="msr hero__stat-icon" aria-hidden="true">schedule</span>
            <div class="hero__stat-text">
              <span class="hero__stat-value">--</span>
              <span class="hero__stat-label">今日运行时长</span>
            </div>
          </div>
          <div class="hero__stat-card">
            <span class="msr hero__stat-icon" aria-hidden="true">deployed_code</span>
            <div class="hero__stat-text">
              <span class="hero__stat-value">{{ platformCount }}</span>
              <span class="hero__stat-label">已使用平台数</span>
            </div>
          </div>
          <div class="hero__stat-card">
            <span class="msr hero__stat-icon" aria-hidden="true">deployed_code_update</span>
            <div class="hero__stat-text">
              <span class="hero__stat-value">{{ totalCount }}</span>
              <span class="hero__stat-label">实例总数</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 实例空态、卡片列表与新建入口 -->
      <section class="instances-section">
        <h2 class="instances-section__title">实例</h2>

        <div v-if="totalCount === 0" class="empty-state">
          <span class="msr empty-state__icon" aria-hidden="true">rocket_launch</span>
          <p class="empty-state__text">还没有任何实例，安装一个即可开始使用</p>
          <button class="btn btn--filled state-layer" type="button" @click="goInstall">
            去安装
          </button>
        </div>

        <div v-else class="instances-grid">
          <InstanceCard
            v-for="instance in instancesStore.instances"
            :key="instance.id"
            :instance="instance"
            @start="onStart"
            @stop="onStop"
            @restart="onRestart"
            @logs="onLogs"
            @remove="onRemove"
            @open-folder="onOpenFolder"
          />

          <button class="new-instance-card state-layer" type="button" @click="goInstall">
            <span class="msr new-instance-card__icon" aria-hidden="true">add</span>
            <span class="new-instance-card__label">新建实例</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 页面滚动容器与主体间距 */
.dashboard {
  height: 100%;
  overflow-y: auto;
}

.dashboard__body {
  display: flex;
  flex-direction: column;
  gap: 32px;
  padding: 0 32px 32px;
}

/* 运行实例汇总与统计项 */
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 24px;
  padding: 32px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.hero__count {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.hero__count-main {
  font: var(--md-sys-typescale-display-small);
}

.hero__count-sep {
  font: var(--md-sys-typescale-headline-small);
  opacity: 0.6;
}

.hero__count-total {
  font: var(--md-sys-typescale-headline-small);
  opacity: 0.8;
}

.hero__count-label {
  margin-left: 8px;
  font: var(--md-sys-typescale-body-medium);
  opacity: 0.85;
}

.hero__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.hero__stat-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: var(--md-sys-shape-corner-large);
  background: color-mix(in srgb, var(--md-sys-color-on-primary-container) 8%, transparent);
  min-width: 140px;
}

.hero__stat-icon {
  color: var(--md-sys-color-on-primary-container);
}

.hero__stat-text {
  display: flex;
  flex-direction: column;
}

.hero__stat-value {
  font: var(--md-sys-typescale-title-medium);
}

.hero__stat-label {
  font: var(--md-sys-typescale-body-small);
  opacity: 0.85;
}

/* 实例网格、空态和新建卡片 */
.instances-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.instances-section__title {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
}

.instances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.new-instance-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 160px;
  border: 1px dashed var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-large);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}

.new-instance-card__icon {
  font-size: 32px;
}

.new-instance-card__label {
  font: var(--md-sys-typescale-label-large);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 64px 32px;
  text-align: center;
}

.empty-state__icon {
  font-size: 64px;
  color: var(--md-sys-color-on-surface-variant);
}

.empty-state__text {
  margin: 0;
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface-variant);
}

.btn {
  height: 40px;
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
</style>
