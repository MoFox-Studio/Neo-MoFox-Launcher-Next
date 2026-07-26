import { createRouter, createWebHashHistory } from 'vue-router';

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
