<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useInstancesStore } from '@/stores/instances';
import { useWindowTitle } from '@/composables/use-window-title';
import InstanceCard from '@/components/InstanceCard.vue';

const router = useRouter();
const instancesStore = useInstancesStore();

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了，注意休息';
  if (hour < 12) return '早上好，开始新的一天';
  if (hour < 18) return '下午好，来看看实例状态';
  return '晚上好，看看今天的实例情况';
});

useWindowTitle({ title: '概览', subtitle: greeting });

const favoriteInstances = computed(() =>
  instancesStore.instances.filter((instance) => instance.extra?.isLike === true),
);
const totalCount = computed(() => favoriteInstances.value.length);
const runningCount = computed(
  () => favoriteInstances.value.filter((instance) => instance.status === 'running').length,
);
const problemCount = computed(
  () => favoriteInstances.value.filter((instance) => instance.status === 'error').length,
);
const platformCount = computed(
  () =>
    new Set(favoriteInstances.value.map((instance) => instance.platform?.id).filter(Boolean)).size,
);
const hasAnyInstances = computed(() => instancesStore.instances.length > 0);

const heroState = computed<'error' | 'running' | 'idle'>(() => {
  if (problemCount.value > 0) return 'error';
  if (runningCount.value > 0) return 'running';
  return 'idle';
});
const heroIcon = computed(() => {
  if (heroState.value === 'error') return 'error';
  if (heroState.value === 'running') return 'play_circle';
  return 'mode_standby';
});
const heroTitle = computed(() => {
  if (problemCount.value > 0) return `${problemCount.value} 个收藏实例需要处理`;
  if (runningCount.value > 0) return `${runningCount.value} 个实例正在运行`;
  if (totalCount.value > 0) return '收藏实例均处于待机状态';
  return hasAnyInstances.value ? '还没有收藏实例' : '准备创建第一个实例';
});
const heroDescription = computed(() => {
  if (problemCount.value > 0) return '打开实例管理或日志，查看具体错误与恢复选项。';
  if (runningCount.value > 0)
    return `共 ${totalCount.value} 个收藏实例，运行状态会在这里实时同步。`;
  if (totalCount.value > 0) return '需要时可直接从下方卡片启动，常用实例会一直留在概览。';
  return hasAnyInstances.value
    ? '在实例管理中收藏常用实例，它们就会出现在这里。'
    : '使用主导航中的添加按钮，安装或导入一个 Neo-MoFox。';
});

onMounted(() => {
  void instancesStore.refresh();
});

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
  <div class="dashboard">
    <div class="dashboard__body">
      <section class="hero" :class="`hero--${heroState}`">
        <div class="hero__main">
          <span class="hero__mark" aria-hidden="true">
            <span class="msr msr--fill">{{ heroIcon }}</span>
          </span>
          <div class="hero__copy">
            <p class="hero__eyebrow">{{ greeting }}</p>
            <h1>{{ heroTitle }}</h1>
            <p>{{ heroDescription }}</p>
          </div>
        </div>
        <button type="button" class="hero__action state-layer" @click="openInstances">
          管理全部
          <span class="msr" aria-hidden="true">arrow_forward</span>
        </button>
      </section>

      <section class="metric-group" aria-label="收藏实例摘要">
        <button type="button" class="metric state-layer" @click="openInstances">
          <span class="metric__icon"><span class="msr msr--fill">favorite</span></span>
          <span class="metric__copy">
            <strong>{{ totalCount }}</strong>
            <small>收藏实例</small>
          </span>
        </button>
        <button type="button" class="metric metric--running state-layer" @click="openInstances">
          <span class="metric__icon"><span class="msr msr--fill">play_arrow</span></span>
          <span class="metric__copy">
            <strong>{{ runningCount }}</strong>
            <small>正在运行</small>
          </span>
        </button>
        <button type="button" class="metric state-layer" @click="openInstances">
          <span class="metric__icon"><span class="msr">deployed_code</span></span>
          <span class="metric__copy">
            <strong>{{ platformCount }}</strong>
            <small>平台类型</small>
          </span>
        </button>
      </section>

      <section class="instances-section">
        <header class="instances-section__header">
          <div>
            <h2>常用实例</h2>
            <p>收藏的实例会出现在这里，状态与操作保持同步。</p>
          </div>
          <button type="button" class="instances-section__link state-layer" @click="openInstances">
            查看全部
          </button>
        </header>

        <div v-if="!hasAnyInstances" class="empty-state">
          <span class="empty-state__mark" aria-hidden="true">
            <span class="msr">rocket_launch</span>
          </span>
          <h3>还没有实例</h3>
          <p>使用主导航中的添加按钮，开始安装或导入。</p>
        </div>

        <div v-else-if="totalCount === 0" class="empty-state">
          <span class="empty-state__mark" aria-hidden="true">
            <span class="msr">favorite_border</span>
          </span>
          <h3>收藏列表为空</h3>
          <p>在实例管理中收藏常用实例，它们就会固定在概览。</p>
          <button type="button" class="instances-section__link state-layer" @click="openInstances">
            前往实例列表
          </button>
        </div>

        <div v-else class="instances-grid">
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
      </section>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  height: 100%;
  overflow-y: auto;
}

.dashboard__body {
  width: min(100%, 1240px);
  display: flex;
  flex-direction: column;
  gap: 22px;
  margin: 0 auto;
  padding: 28px 32px calc(36px + var(--app-nav-overlay-bottom-inset))
    calc(32px + var(--app-nav-overlay-start-inset));
}

.hero {
  min-height: 168px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 30px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-card-filter);
  -webkit-backdrop-filter: var(--app-glass-card-filter);
  color: var(--md-sys-color-on-surface);
}

.hero--running {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.hero--error {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.hero__main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 20px;
}

.hero__mark {
  flex: none;
  width: 72px;
  height: 72px;
  display: grid;
  place-items: center;
  border-radius: 24px;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-primary);
}

.hero--running .hero__mark {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.hero--error .hero__mark {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.hero__mark .msr {
  font-size: 40px;
}

.hero__copy {
  min-width: 0;
}

.hero__eyebrow,
.hero__copy h1,
.hero__copy > p:last-child {
  margin: 0;
}

.hero__eyebrow {
  font: var(--md-sys-typescale-label-large);
  opacity: 0.75;
}

.hero__copy h1 {
  margin-top: 4px;
  font: var(--md-sys-typescale-headline-medium);
}

.hero__copy > p:last-child {
  max-width: 620px;
  margin-top: 7px;
  font: var(--md-sys-typescale-body-medium);
  opacity: 0.82;
}

.hero__action {
  flex: none;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.hero--running .hero__action {
  background: var(--md-sys-color-on-primary-container);
  color: var(--md-sys-color-primary-container);
}

.hero--error .hero__action {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.hero__action .msr {
  font-size: 18px;
}

.metric-group {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
}

.metric {
  min-height: 86px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 20px;
  border: 0;
  border-radius: 7px;
  background: var(--app-glass-row);
  color: var(--md-sys-color-on-surface);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.metric:first-child {
  border-radius: 20px 7px 7px 20px;
}

.metric:last-child {
  border-radius: 7px 20px 20px 7px;
}

.metric:hover {
  background: var(--md-sys-color-surface-container-high);
}

.metric__icon {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.metric--running .metric__icon {
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.metric__copy {
  display: flex;
  flex-direction: column;
}

.metric__copy strong {
  font: var(--md-sys-typescale-title-large);
}

.metric__copy small {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.instances-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.instances-section__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 4px 4px 0;
}

.instances-section__header h2,
.instances-section__header p {
  margin: 0;
}

.instances-section__header h2 {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-large);
}

.instances-section__header p {
  margin-top: 3px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.instances-section__link {
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.instances-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.empty-state {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 32px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-card-filter);
  -webkit-backdrop-filter: var(--app-glass-card-filter);
  text-align: center;
}

.empty-state__mark {
  width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  margin-bottom: 8px;
  border-radius: 22px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.empty-state__mark .msr {
  font-size: 34px;
}

.empty-state h3,
.empty-state p {
  margin: 0;
}

.empty-state h3 {
  font: var(--md-sys-typescale-title-large);
}

.empty-state p {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

@media (max-width: 760px) {
  .dashboard__body {
    padding: 18px 18px calc(28px + var(--app-nav-overlay-bottom-inset))
      calc(18px + var(--app-nav-overlay-start-inset));
  }

  .hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .hero__mark {
    width: 58px;
    height: 58px;
    border-radius: 19px;
  }

  .hero__copy h1 {
    font: var(--md-sys-typescale-headline-small);
  }

  .metric-group {
    grid-template-columns: 1fr;
  }

  .metric:first-child {
    border-radius: 20px 20px 7px 7px;
  }

  .metric:last-child {
    border-radius: 7px 7px 20px 20px;
  }
}
</style>
