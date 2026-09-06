import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import type { VenvPathInspection } from '../../shared/domain/venv';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 虚拟环境管理 IPC 边界：路径探测、包列表、安装、卸载、更新、版本与包信息查询。 */
export interface VenvActions {
  inspect(value: string): Promise<VenvPathInspection>;
  getVenvInfo(instanceId: string): Promise<import('../../shared/domain/venv').VenvInfo>;
  install(
    instanceId: string,
    name: string,
    version?: string,
  ): Promise<import('../../shared/domain/venv').VenvPackageResult>;
  uninstall(
    instanceId: string,
    name: string,
  ): Promise<import('../../shared/domain/venv').VenvPackageResult>;
  update(
    instanceId: string,
    name?: string,
  ): Promise<import('../../shared/domain/venv').VenvPackageResult>;
  queryVersions(instanceId: string, name: string): Promise<string[]>;
  getPackageInfo(
    instanceId: string,
    name: string,
  ): Promise<import('../../shared/domain/venv').VenvPackageInfo>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册虚拟环境管理相关 IPC 通道。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的虚拟环境动作集合。
 */
export function registerVenvIpc(ipcMain: IpcMainRegistrar, actions: VenvActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.inspectVenvPath, (path) =>
    actions.inspect(requireString(path, 'Venv path')),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.getVenvInfo, (instanceId) =>
    actions.getVenvInfo(requireId(instanceId)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.installVenvPackage, (instanceId, name, version) =>
    actions.install(
      requireId(instanceId),
      requireString(name, 'Package name'),
      requireOptionalString(version),
    ),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.uninstallVenvPackage, (instanceId, name) =>
    actions.uninstall(requireId(instanceId), requireString(name, 'Package name')),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.updateVenvPackage, (instanceId, name) =>
    actions.update(requireId(instanceId), requireOptionalString(name)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.queryVenvPackageVersions, (instanceId, name) =>
    actions.queryVersions(requireId(instanceId), requireString(name, 'Package name')),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.getVenvPackageInfo, (instanceId, name) =>
    actions.getPackageInfo(requireId(instanceId), requireString(name, 'Package name')),
  );
}

/** 校验实例 ID 字符串，空值抛出 `INVALID_ARGUMENT`。 */
function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
  }
  return value;
}

/** 校验必填字符串参数。 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', `${label} must be a string`);
  }
  return value;
}

/** 校验可选字符串参数；`undefined` 透传。 */
function requireOptionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, 'Package version');
}

/**
 * 在指定通道上注册 IPC 处理器，统一捕获并序列化异常为跨进程错误协议。
 */
function register(
  ipcMain: IpcMainRegistrar,
  channel: string,
  handler: (...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      throw serializeIpcError(error);
    }
  });
}
