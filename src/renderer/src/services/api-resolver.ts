import type { MofoxApi } from '@shared/ipc';

// 统一选择预加载桥接或显式开启的演示 API，避免生产环境静默降级。
export function resolveMofoxApi(
  bridge: MofoxApi | undefined,
  demoEnabled: boolean,
  demoApi: MofoxApi,
): MofoxApi {
  if (bridge) return bridge;
  if (demoEnabled) return demoApi;
  throw new Error(
    'MoFox preload bridge is unavailable. Start the Electron application or enable the explicit demo flag.',
  );
}
