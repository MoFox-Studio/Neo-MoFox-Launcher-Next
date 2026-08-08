import { createRouter, createWebHashHistory } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';

// Electron 渲染进程使用 Hash 路由，页面组件按路由懒加载。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
    { path: '/instances', name: 'instances', component: () => import('@/views/InstancesView.vue') },
    { path: '/instances/:id/logs', name: 'instance-logs', component: () => import('@/views/InstanceLogView.vue') },
    { path: '/install/:mode?', name: 'install', component: () => import('@/views/InstallView.vue') },
    { path: '/oobe', name: 'oobe', component: () => import('@/views/OobeView.vue'), meta: { bare: true } },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  ],
});

// OOBE 守卫：未完成首次引导时强制停留在 /oobe，避免渲染进程绕过依赖安装与设置流程；
// 已完成后不再进入引导，直接回到主界面。
router.beforeEach((to) => {
  const settings = useSettingsStore();
  const completed = settings.loaded && settings.settings.oobeCompleted;
  if (to.name === 'oobe') {
    return completed ? { name: 'dashboard' } : true;
  }
  if (!completed) {
    return { name: 'oobe' };
  }
  return true;
});
