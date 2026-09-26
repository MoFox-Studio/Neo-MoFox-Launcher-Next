<script setup lang="ts">
// 主页：固定的状态 Hero + 按用户配置渲染的小部件行；布局由设置中的 home 字段驱动。
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useInstancesStore } from '@/stores/instances';
import { useWindowTitle } from '@/composables/use-window-title';
import { useHomeWidgets } from '@/composables/use-home-widgets';
import { greetingByHour } from '@/utils/greeting';

const router = useRouter();
const instancesStore = useInstancesStore();
const { rows } = useHomeWidgets();

const greeting = computed(() => greetingByHour(new Date().getHours()));

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
  if (totalCount.value > 0) return '需要时可直接从下方卡片启动，常用实例会一直留在主页。';
  return hasAnyInstances.value
    ? '在实例管理中收藏常用实例，它们就会出现在这里。'
    : '使用主导航中的添加按钮，安装或导入一个 Neo-MoFox。';
});

onMounted(() => {
  void instancesStore.refresh();
});

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

      <!-- 按用户配置的顺序渲染小部件；相邻半宽部件自动并排成行。 -->
      <div
        v-for="(row, rowIndex) in rows"
        :key="rowIndex"
        class="dashboard__row"
        :class="{ 'dashboard__row--single': row.single }"
      >
        <component
          :is="item.definition.component"
          v-for="item in row.items"
          :key="item.state.id"
          :config="item.state.config"
        />
      </div>
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

/* 一行部件：行内等宽分布；行尾落单的半宽部件也会占满整行。 */
.dashboard__row {
  display: flex;
  gap: 22px;
  min-width: 0;
}

.dashboard__row > * {
  flex: 1 1 0;
  min-width: 0;
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

@media (max-width: 760px) {
  .dashboard__body {
    padding: 18px 18px calc(28px + var(--app-nav-overlay-bottom-inset))
      calc(18px + var(--app-nav-overlay-start-inset));
  }

  .dashboard__row {
    flex-direction: column;
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
}
</style>

<style src="@/components/home/home-widgets.css"></style>
