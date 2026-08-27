<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import { useWindowTitle } from '@/composables/use-window-title';
import InstanceInfoPanel from '@/components/instance-manage/InstanceInfoPanel.vue';
import InstanceMorePanel from '@/components/instance-manage/InstanceMorePanel.vue';
import InstanceUpdatePanel from '@/components/instance-manage/InstanceUpdatePanel.vue';

// 实例管理页：内容分区抽为独立面板，新增「更新」分区用于主程序与平台版本管理。
type ManageTab = 'info' | 'more' | 'update';

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

onMounted(async () => {
  await instancesStore.refresh();
  if (!instance.value) {
    void router.replace({ name: 'instances' });
    return;
  }
  try {
    platforms.value = await mofoxApi.listBotPlatforms();
  } catch (error) {
    showToast(`平台列表加载失败: ${error instanceof Error ? error.message : String(error)}`);
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

function onDeleted(): void {
  void router.replace({ name: 'instances' });
}
</script>

<template>
  <div class="manage-view">
    <!-- 侧边栏分区导航；底部常驻日志入口 -->
    <aside class="manage-sidebar">
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

      <div class="manage-sidebar__footer">
        <button class="manage-sidebar__action state-layer" type="button" @click="openLogs">
          <span class="msr manage-sidebar__icon" aria-hidden="true">terminal</span>
          <span class="manage-sidebar__text">
            <span class="manage-sidebar__label">查看日志</span>
            <span class="manage-sidebar__description">查看运行日志与终端输出</span>
          </span>
        </button>
      </div>
    </aside>

    <!-- 内容画布：按选中分区渲染对应独立面板 -->
    <main class="manage-content">
      <InstanceInfoPanel
        v-if="instance && activeTab === 'info'"
        :instance="instance"
        @back="goBack"
      />
      <InstanceMorePanel
        v-else-if="instance && activeTab === 'more'"
        :instance="instance"
        :platforms="platforms"
        @toast="showToast"
        @deleted="onDeleted"
      />
      <InstanceUpdatePanel
        v-else-if="instance && activeTab === 'update'"
        :instance="instance"
        @toast="showToast"
      />
      <p v-else class="manage-group__empty">实例不存在或已被删除。</p>
    </main>

    <transition name="toast">
      <div v-if="toast" class="manage-view__toast" role="status">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
/* 与设置页一致的双栏布局：左栏贴边玻璃导航，右侧独立内容画布并单独模糊。 */
.manage-view {
  --manage-sidebar-width: 240px;

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
  grid-row: 1 / -1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 24px 12px 16px;
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
  grid-column: 2;
  width: 100%;
  min-width: 0;
  margin: 0 auto;
  padding: 20px 32px 64px;
  overflow-y: auto;
}

.manage-group__empty {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
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
</style>
