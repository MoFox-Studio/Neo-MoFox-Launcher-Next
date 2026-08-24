<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWindowTitle } from '@/composables/use-window-title';
import InstallWizard from '@/components/install/InstallWizard.vue';
import ManualImportWizard from '@/components/install/ManualImportWizard.vue';

type InstallMode = 'fresh' | 'import';

const route = useRoute();
const router = useRouter();

// 路由参数只由加号入口写入；缺省时保留新鲜安装作为直接访问的默认流程。
const mode = computed<InstallMode>(() => (route.params.mode === 'import' ? 'import' : 'fresh'));
const title = computed(() => (mode.value === 'import' ? '手动导入' : '新鲜安装'));
const subtitle = computed(() =>
  mode.value === 'import' ? '登记本机已有的 Neo-MoFox 目录' : '下载并配置新的机器人平台实例',
);

// 安装流程的标题显示在窗口栏；两种模式都不保留页内顶栏，返回入口统一放在向导侧栏左下角。
useWindowTitle({ title, subtitle });

function leave(): void {
  void router.push({ name: 'instances' });
}
</script>

<template>
  <div class="install-view">
    <div class="install-view__content">
      <InstallWizard v-if="mode === 'fresh'" @close="leave" @complete="leave" />
      <ManualImportWizard v-else @close="leave" @complete="leave" />
    </div>
  </div>
</template>

<style scoped>
.install-view {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.install-view__content {
  min-height: 0;
  flex: 1;
}
</style>
