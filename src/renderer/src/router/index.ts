import { createRouter, createWebHashHistory } from 'vue-router';

// Electron 渲染进程使用 Hash 路由，页面组件按路由懒加载。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
    { path: '/instances', name: 'instances', component: () => import('@/views/InstancesView.vue') },
    { path: '/instances/:id/logs', name: 'instance-logs', component: () => import('@/views/InstanceLogView.vue') },
    { path: '/install', name: 'install', component: () => import('@/views/InstallWizardView.vue') },
    { path: '/oobe', name: 'oobe', component: () => import('@/views/OobeView.vue'), meta: { bare: true } },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
  ],
});
