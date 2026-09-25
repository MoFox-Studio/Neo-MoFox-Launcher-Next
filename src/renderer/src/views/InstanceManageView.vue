<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import { useWindowTitle } from '@/composables/use-window-title';
import InstanceInfoPanel from '@/components/instance-manage/InstanceInfoPanel.vue';
import InstanceMorePanel from '@/components/instance-manage/InstanceMorePanel.vue';
import InstanceUpdatePanel from '@/components/instance-manage/InstanceUpdatePanel.vue';
import InstanceVenvPanel from '@/components/instance-manage/InstanceVenvPanel.vue';

// 实例管理页：内容分区抽为独立面板，新增「更新」与「虚拟环境」分区。
type ManageTab = 'info' | 'more' | 'venv' | 'update';

const route = useRoute();
const router = useRouter();
const instancesStore = useInstancesStore();

const instanceId = computed(() => String(route.params.id ?? ''));
const instance = computed(() => instancesStore.byId(instanceId.value));

// 页面标题跟随实例名称与运行状态展示在窗口栏。
useWindowTitle({ title: () => instance.value?.name ?? '实例管理', subtitle: '实例管理' });

const NAV_ITEMS: { id: ManageTab; label: string; description: string; icon: string }[] = [
  { id: 'info', label: '信息查看', description: '实例的运行状态与目录信息', icon: 'info' },
  { id: 'more', label: '更多', description: '文件系统操作与实例信息修改', icon: 'more_horiz' },
  { id: 'venv', label: '虚拟环境', description: 'Python 环境与依赖包管理', icon: 'science' },
  { id: 'update', label: '更新', description: '主程序与平台版本管理', icon: 'system_update' },
];

const activeTab = ref<ManageTab>('info');

const platforms = ref<BotPlatformMetadata[]>([]);
const toast = ref('');
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 2600);
}

// 首次刷新完成前不触发「实例消失」跳转，避免与初始加载竞态。
let initialLoadDone = false;

onMounted(async () => {
  await instancesStore.refresh();
  if (!instance.value) {
    void router.replace({ name: 'instances' });
    return;
  }
  initialLoadDone = true;
  try {
    platforms.value = await mofoxApi.listBotPlatforms();
  } catch (error) {
    showToast(`平台列表加载失败: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// 删除实例时仓库刷新会让当前面板先一步卸载，`deleted` 事件可能因此丢失；
// 这里直接监听实例从列表中消失，统一负责送回主页面。
watch(instance, (value) => {
  if (initialLoadDone && !value && route.name === 'instance-manage') {
    returnToDashboard();
  }
});

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer);
});

function openLogs(): void {
  void router.push({ name: 'instance-logs', params: { id: instanceId.value } });
}

function goBack(): void {
  router.back();
}

// 删除完成后送回主页面；同时供「实例不存在」兜底状态的返回按钮使用。
function returnToDashboard(): void {
  void router.replace({ name: 'dashboard' });
}
</script>

<template>
  <div class="manage-view">
    <aside class="manage-sidebar" aria-label="实例管理侧栏">
      <h2 class="manage-sidebar__heading" :title="instance?.name">
        {{ instance?.name || '实例管理' }}
      </h2>
      <nav class="manage-sidebar__nav" aria-label="实例管理分区">
        <button
          v-for="item in NAV_ITEMS"
          :key="item.id"
          class="manage-sidebar__item state-layer"
          :class="{ 'manage-sidebar__item--active': activeTab === item.id }"
          type="button"
          :aria-current="activeTab === item.id ? 'page' : undefined"
          @click="activeTab = item.id"
        >
          <span
            class="msr manage-sidebar__icon"
            :class="{ 'msr--fill': activeTab === item.id }"
            aria-hidden="true"
          >
            {{ item.icon }}
          </span>
          <span class="manage-sidebar__text">
            <span class="manage-sidebar__label">{{ item.label }}</span>
            <span class="manage-sidebar__description">{{ item.description }}</span>
          </span>
        </button>
      </nav>

      <button
        class="manage-sidebar__action state-layer"
        type="button"
        title="查看运行日志"
        aria-label="查看运行日志"
        @click="openLogs"
      >
        <span class="msr" aria-hidden="true">terminal</span>
        <span>运行日志</span>
      </button>
    </aside>

    <!-- 内容画布：按选中分区渲染对应独立面板 -->
    <main class="manage-content">
      <InstanceInfoPanel
        v-if="instance && activeTab === 'info'"
        :instance="instance"
        @back="goBack"
        @toast="showToast"
      />
      <InstanceMorePanel
        v-else-if="instance && activeTab === 'more'"
        :instance="instance"
        :platforms="platforms"
        @toast="showToast"
        @deleted="returnToDashboard"
        @home="returnToDashboard"
      />
      <InstanceVenvPanel
        v-else-if="instance && activeTab === 'venv'"
        :instance="instance"
        @toast="showToast"
      />
      <InstanceUpdatePanel
        v-else-if="instance && activeTab === 'update'"
        :instance="instance"
        @toast="showToast"
      />
      <!-- 实例不存在时的兜底状态：整卡居中展示，仅在列表刷新完成后出现 -->
      <div v-else-if="!instancesStore.loading" class="manage-missing" role="status">
        <span class="manage-missing__mark" aria-hidden="true">
          <span class="msr">delete_forever</span>
        </span>
        <h2>实例不存在</h2>
        <p>该实例可能已被删除，或访问地址有误。</p>
        <button class="manage-missing__action state-layer" type="button" @click="returnToDashboard">
          返回主页面
        </button>
      </div>
    </main>

    <transition name="toast">
      <div v-if="toast" class="manage-view__toast" role="status">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
/* 与设置页一致的双栏布局：左栏贴边玻璃导航，右侧独立内容画布并单独模糊。 */
.manage-view {
  --manage-sidebar-width: calc(240px + var(--app-nav-overlay-start-inset));

  position: relative;
  height: 100%;
  display: grid;
  grid-template-columns: var(--manage-sidebar-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

/* 只为右侧内容铺设主画布，让侧栏能直接模糊桌面材质或应用壁纸。 */
.manage-view::before {
  position: absolute;
  z-index: 0;
  inset: 0 0 0 var(--manage-sidebar-width);
  background: var(--app-current-content-surface);
  backdrop-filter: var(--app-current-content-filter);
  -webkit-backdrop-filter: var(--app-current-content-filter);
  content: '';
  pointer-events: none;
}

.manage-sidebar,
.manage-content {
  position: relative;
  z-index: 1;
}

/* 贴边导航抽屉使用较轻的内嵌玻璃层，与设置页侧栏一致。 */
.manage-sidebar {
  overflow-y: auto;
  grid-row: 1 / -1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 24px 12px calc(16px + var(--app-nav-overlay-bottom-inset))
    calc(12px + var(--app-nav-overlay-start-inset));
  border-right: 1px solid var(--app-glass-border);
  background: var(--app-subrail-surface);
  backdrop-filter: var(--app-subrail-filter);
  -webkit-backdrop-filter: var(--app-subrail-filter);
}

.manage-sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.manage-sidebar__heading {
  overflow: hidden;
  margin: 0 16px 20px;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manage-sidebar__action {
  margin-top: auto;
  flex-shrink: 0;
}

.manage-sidebar__item:focus-visible,
.manage-sidebar__action:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: -2px;
}

.manage-sidebar__item,
.manage-sidebar__action {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 16px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.manage-sidebar__item--active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.manage-sidebar__action:hover {
  background: color-mix(in srgb, var(--md-sys-color-primary) 10%, transparent);
  color: var(--md-sys-color-primary);
}

.manage-sidebar__icon {
  flex: 0 0 auto;
  font-size: 24px;
}

.manage-sidebar__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.manage-sidebar__label {
  font: var(--md-sys-typescale-label-large);
}

.manage-sidebar__description {
  overflow: hidden;
  color: inherit;
  font: var(--md-sys-typescale-body-small);
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manage-sidebar__footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--app-glass-border);
}

.manage-content {
  min-height: 0;
  grid-column: 2;
  width: 100%;
  min-width: 0;
  margin: 0 auto;
  padding: 20px 32px calc(64px + var(--app-nav-overlay-bottom-inset));
  overflow-y: auto;
}

/* 实例不存在时的兜底状态：整卡居中，复用应用玻璃卡片语言。 */
.manage-missing {
  width: 100%;
  min-height: 100%;
  max-width: 824px;
  box-sizing: border-box;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 48px 32px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-card-filter);
  -webkit-backdrop-filter: var(--app-glass-card-filter);
  text-align: center;
}

.manage-missing__mark {
  width: 68px;
  height: 68px;
  display: grid;
  place-items: center;
  margin-bottom: 9px;
  border-radius: 23px;
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.manage-missing__mark .msr {
  font-size: 36px;
}

.manage-missing h2 {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
}

.manage-missing p {
  max-width: 380px;
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.manage-missing__action {
  min-height: 40px;
  margin-top: 8px;
  padding: 0 20px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.manage-view__toast {
  position: fixed;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100% - 64px));
  padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  font: var(--md-sys-typescale-body-medium);
  box-shadow: var(--md-sys-elevation-level3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 30;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: translateX(-50%);
  }
}

@media (max-width: 900px) {
  .manage-view {
    --manage-sidebar-width: calc(200px + var(--app-nav-overlay-start-inset));
  }
  .manage-sidebar__description {
    display: none;
  }
}

@media (max-width: 680px) {
  .manage-view {
    --manage-sidebar-width: 0px;
    display: flex;
    flex-direction: column;
  }
  .manage-view::before {
    top: 61px;
  }
  .manage-sidebar {
    flex: none;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px calc(8px + var(--app-nav-overlay-start-inset));
    border-right: 0;
    border-bottom: 1px solid var(--app-glass-border);
  }
  .manage-sidebar__heading {
    display: none;
  }
  .manage-sidebar__nav {
    min-width: 0;
    flex: 1;
    flex-direction: row;
    overflow-x: auto;
  }
  .manage-sidebar__item {
    width: auto;
    flex: none;
    min-height: 44px;
    padding: 6px 12px;
  }
  .manage-sidebar__action {
    width: 44px;
    min-height: 44px;
    justify-content: center;
    padding: 0;
    margin-top: 0;
  }
  .manage-sidebar__action > span:last-child {
    display: none;
  }
  .manage-content {
    flex: 1;
    padding: 16px 20px calc(32px + var(--app-nav-overlay-bottom-inset))
      calc(20px + var(--app-nav-overlay-start-inset));
  }
}
</style>
