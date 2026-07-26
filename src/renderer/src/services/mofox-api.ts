import type { MofoxApi } from '@shared/ipc';
import { mockApi } from './mock-api';
import { resolveMofoxApi } from './api-resolver';

/**
 * Typed access to the preload bridge. The mock is available only when
 * explicitly enabled for a renderer demo build.
 */
export const mofoxApi: MofoxApi = resolveMofoxApi(
  window.mofoxAPI,
  import.meta.env.VITE_MOFOX_DEMO === 'true',
  mockApi,
);
