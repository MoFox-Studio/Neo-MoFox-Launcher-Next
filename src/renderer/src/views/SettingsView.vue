<script setup lang="ts">
// 设置页：内容分区抽为独立面板，本视图仅负责侧栏导航与面板挂载（同实例管理页模式）。
import { ref } from 'vue';
import { useWindowTitle } from '@/composables/use-window-title';
import SettingsAboutPanel from '@/components/settings/SettingsAboutPanel.vue';
import SettingsAppearancePanel from '@/components/settings/SettingsAppearancePanel.vue';
import SettingsGeneralPanel from '@/components/settings/SettingsGeneralPanel.vue';
import SettingsHomePanel from '@/components/settings/SettingsHomePanel.vue';
import SettingsMigrationPanel from '@/components/settings/SettingsMigrationPanel.vue';

type SettingsTab = 'appearance' | 'home' | 'general' | 'migration' | 'about';

const SETTING_SECTIONS: { id: SettingsTab; label: string; description: string; icon: string }[] = [
  { id: 'appearance', label: '外观', description: '主题、颜色与语言', icon: 'palette' },
  { id: 'home', label: '主页', description: '小部件开关、排序与配置', icon: 'dashboard_customize' },
  { id: 'general', label: '通用', description: '目录、运行行为与日志', icon: 'tune' },
  {
    id: 'migration',
    label: '数据迁移',
    description: '导入旧版实例与源数据文件',
    icon: 'cloud_sync',
  },
  { id: 'about', label: '关于', description: '版本与更新信息', icon: 'info' },
];

const activeTab = ref<SettingsTab>('appearance');

// 设置页标题显示在窗口栏。
useWindowTitle({ title: '设置', subtitle: '调整启动器的外观、行为与数据选项' });
</script>

<template>
  <div class="settings-view">
    <aside class="settings-sidebar" aria-label="设置侧栏">
      <h2 class="settings-sidebar__heading">设置</h2>
      <nav class="settings-sidebar__nav" aria-label="设置分区">
        <button
          v-for="section in SETTING_SECTIONS"
          :key="section.id"
          class="settings-sidebar__item state-layer"
          :class="{ 'settings-sidebar__item--active': activeTab === section.id }"
          type="button"
          :aria-current="activeTab === section.id ? 'page' : undefined"
          @click="activeTab = section.id"
        >
          <span
            class="msr settings-sidebar__icon"
            :class="{ 'msr--fill': activeTab === section.id }"
            aria-hidden="true"
          >
            {{ section.icon }}
          </span>
          <span class="settings-sidebar__text">
            <span class="settings-sidebar__label">{{ section.label }}</span>
            <span class="settings-sidebar__description">{{ section.description }}</span>
          </span>
        </button>
      </nav>
      <div class="settings-sidebar__status">
        <span class="msr settings-sidebar__status-icon" aria-hidden="true">cloud_done</span>
        <span>自动保存</span>
      </div>
    </aside>

    <!-- 内容画布：按选中分区渲染对应独立面板 -->
    <main class="settings-view__content">
      <SettingsAppearancePanel v-if="activeTab === 'appearance'" />
      <SettingsHomePanel v-else-if="activeTab === 'home'" />
      <SettingsGeneralPanel v-else-if="activeTab === 'general'" />
      <SettingsMigrationPanel v-else-if="activeTab === 'migration'" />
      <SettingsAboutPanel v-else />
    </main>
  </div>
</template>

<style scoped src="./SettingsView.css"></style>
