import type { MofoxApi } from '@shared/ipc';
import { mockApi } from './mock-api';
import { resolveMofoxApi } from './api-resolver';

/**
 * 渲染进程访问预加载桥接的唯一入口。
 * 仅在显式演示构建中允许回退到模拟实现。
 */
export const mofoxApi: MofoxApi = resolveMofoxApi(
  window.mofoxAPI,
  import.meta.env.VITE_MOFOX_DEMO === 'true',
  mockApi,
);
