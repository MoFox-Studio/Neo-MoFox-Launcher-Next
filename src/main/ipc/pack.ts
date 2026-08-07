import type { ManualAddRequest, ManualAddResult } from '../../shared/domain/manual-add';
import type {
  PackExportOptions,
  PackImportRequest,
  PackItemInfo,
  PackManifest,
  PackValidationResult,
} from '../../shared/domain/pack';
import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 整合包与手动添加的 IPC 动作集合，渲染端只能经白名单通道访问。 */
interface PackActions {
  scanPlugins(instanceId: string): Promise<PackItemInfo[]>;
  scanPluginConfigs(instanceId: string): Promise<PackItemInfo[]>;
  exportPack(
    instanceId: string,
    options: PackExportOptions,
    destPath: string,
  ): Promise<void>;
  validatePack(packPath: string): Promise<PackValidationResult>;
  importPack(request: PackImportRequest): Promise<PackManifest>;
  manualAdd(request: ManualAddRequest): Promise<ManualAddResult>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册整合包导出/校验/导入与手动添加相关 IPC 通道。
 *
 * 跨进程边界校验参数基本形状，再委托服务层执行实际文件操作。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的整合包动作集合。
 */
export function registerPackIpc(ipcMain: IpcMainRegistrar, actions: PackActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.scanInstancePlugins, (instanceId) =>
    actions.scanPlugins(requireId(instanceId)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.scanInstancePluginConfigs, (instanceId) =>
    actions.scanPluginConfigs(requireId(instanceId)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.exportIntegrationPack, (instanceId, options, destPath) =>
    actions.exportPack(requireId(instanceId), requireExportOptions(options), requirePath(destPath)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.validateIntegrationPack, (packPath) =>
    actions.validatePack(requirePath(packPath)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.importIntegrationPack, (request) =>
    actions.importPack(requireImportRequest(request)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.manualAddInstance, (request) =>
    actions.manualAdd(requireManualAddRequest(request)),
  );
}

/**
 * 校验实例 ID 字符串。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 去除首尾空白后的实例 ID。
 */
function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
  return value;
}

/**
 * 校验文件系统路径参数。
 *
 * @param value - 未约束的路径参数。
 * @returns 非空路径字符串。
 */
function requirePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new MofoxError('INVALID_ARGUMENT', 'Path is required');
  return value;
}

/**
 * 校验导出选项为对象且元信息字段为字符串。
 *
 * @param value - 未经类型约束的导出选项。
 * @returns 形态合法的导出选项。
 */
function requireExportOptions(value: unknown): PackExportOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Export options must be an object');
  }
  const options = value as Partial<PackExportOptions>;
  if (typeof options.packName !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'packName is required');
  }
  return options as PackExportOptions;
}

/**
 * 校验导入请求的关键字段是否为非空字符串。
 *
 * @param value - 未经类型约束的导入请求。
 * @returns 形态合法的导入请求。
 */
function requireImportRequest(value: unknown): PackImportRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Import request must be an object');
  }
  const request = value as Partial<PackImportRequest>;
  if (
    typeof request.packPath !== 'string' ||
    !request.packPath.trim() ||
    typeof request.targetDir !== 'string' ||
    !request.targetDir.trim()
  ) {
    throw new MofoxError('INVALID_ARGUMENT', 'Import request fields are invalid');
  }
  return request as PackImportRequest;
}

/**
 * 校验手动添加请求的关键字段。
 *
 * @param value - 未经类型约束的手动添加请求。
 * @returns 形态合法的手动添加请求。
 */
function requireManualAddRequest(value: unknown): ManualAddRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Manual add request must be an object');
  }
  const request = value as Partial<ManualAddRequest>;
  if (
    typeof request.mofoxInstallDir !== 'string' ||
    !request.mofoxInstallDir.trim()
  ) {
    throw new MofoxError('INVALID_ARGUMENT', 'mofoxInstallDir is required');
  }
  return request as ManualAddRequest;
}

/**
 * 在指定通道上注册 IPC 处理器，统一捕获并序列化异常。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param channel - 需要监听的 IPC 通道名。
 * @param handler - 实际业务处理函数，参数来自渲染端 invoke 调用。
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
      // Electron IPC 对 Error 实例的结构化克隆并不稳定；只跨进程传递纯字符串。
      // preload 层会根据此前缀重新还原为 MofoxError。
      throw serializeIpcError(error);
    }
  });
}