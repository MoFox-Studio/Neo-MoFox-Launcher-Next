import { createRouter, createWebHashHistory } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import { useInstallStore } from '@/stores/install';

// Electron 渲染进程使用 Hash 路由，页面组件按路由懒加载。
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
    { path: '/instances', name: 'instances', component: () => import('@/views/InstancesView.vue') },
    {
      path: '/instances/:id/manage',
      name: 'instance-manage',
      component: () => import('@/views/InstanceManageView.vue'),
    },
    {
      path: '/instances/:id/logs',
      name: 'instance-logs',
      component: () => import('@/views/InstanceLogView.vue'),
    },
    {
      path: '/install/:mode?',
      name: 'install',
      component: () => import('@/views/InstallView.vue'),
      meta: { splitGlass: true },
    },
    {
      path: '/oobe',
      name: 'oobe',
      component: () => import('@/views/OobeView.vue'),
      meta: { bare: true },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
      meta: { splitGlass: true },
    },
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

// 安装进行中拦截离开安装向导的导航（如点击主导航），交由向导弹出取消确认框，
// 避免用户无确认地直接放弃正在执行的安装。
router.beforeEach((to, from) => {
  if (from.name !== 'install' || to.name === 'install') return true;
  const installStore = useInstallStore();
  if (!installStore.isInstalling) return true;
  installStore.requestCancel();
  return false;
});
