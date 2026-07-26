import type { MofoxApi } from '@shared/ipc';

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