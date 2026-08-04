import type {
  DirectoryPickerOptions,
  DirectoryPickerResult,
  FilePickerOptions,
  FilePickerResult,
} from '../../shared/domain/file-picker';
import { MofoxError, serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/**
 * 通用对话框服务：仅暴露渲染进程需要的选择文件/文件夹能力。
 * 所有具体窗口句柄与 Electron API 在适配器中实现，便于单元测试。
 */
export interface DialogActions {
  pickFile(options: FilePickerOptions | undefined): Promise<FilePickerResult>;
  pickDirectory(
    options: DirectoryPickerOptions | undefined,
  ): Promise<DirectoryPickerResult>;
}

export interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册通用对话框 IPC 通道。
 *
 * 在跨进程边界处校验选项载荷形状，再委托给对话框服务调用 Electron `dialog`。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的对话框动作集合。
 */
export function registerCommonIpc(ipcMain: IpcMainRegistrar, actions: DialogActions): void {
  register(ipcMain, IPC_INVOKE_CHANNELS.pickFile, (rawOptions) =>
    actions.pickFile(requireFilePickerOptions(rawOptions)),
  );
  register(ipcMain, IPC_INVOKE_CHANNELS.pickDirectory, (rawOptions) =>
    actions.pickDirectory(requireDirectoryPickerOptions(rawOptions)),
  );
}

/**
 * 校验来自渲染端的文件选择器载荷，并归一化为 `FilePickerOptions | undefined`。
 *
 * 仅检查顶层字段形状与过滤器结构；扩展名等字段语义交由 Electron dialog 校验。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 通过校验的选项对象，或 `undefined` 表示使用默认。
 */
function requireFilePickerOptions(value: unknown): FilePickerOptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'File picker options must be an object');
  }
  const options = value as Partial<FilePickerOptions>;
  if (options.title !== undefined && typeof options.title !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'File picker title must be a string');
  }
  if (options.defaultPath !== undefined && typeof options.defaultPath !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'File picker defaultPath must be a string');
  }
  if (options.multiSelections !== undefined && typeof options.multiSelections !== 'boolean') {
    throw new MofoxError('INVALID_ARGUMENT', 'File picker multiSelections must be a boolean');
  }
  if (options.filters !== undefined) {
    if (!Array.isArray(options.filters)) {
      throw new MofoxError('INVALID_ARGUMENT', 'File picker filters must be an array');
    }
    for (const filter of options.filters) {
      if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
        throw new MofoxError('INVALID_ARGUMENT', 'File picker filter must be an object');
      }
      const f = filter as Partial<FilePickerFilter>;
      if (typeof f.name !== 'string') {
        throw new MofoxError('INVALID_ARGUMENT', 'File picker filter name must be a string');
      }
      if (!Array.isArray(f.extensions) || f.extensions.some((e) => typeof e !== 'string')) {
        throw new MofoxError('INVALID_ARGUMENT', 'File picker filter extensions must be strings');
      }
    }
  }
  return options as FilePickerOptions;
}

/**
 * 校验来自渲染端的文件夹选择器载荷，并归一化为 `DirectoryPickerOptions | undefined`。
 *
 * @param value - 未经类型约束的 IPC 参数。
 * @returns 通过校验的选项对象，或 `undefined` 表示使用默认。
 */
function requireDirectoryPickerOptions(
  value: unknown,
): DirectoryPickerOptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MofoxError('INVALID_ARGUMENT', 'Directory picker options must be an object');
  }
  const options = value as Partial<DirectoryPickerOptions>;
  if (options.title !== undefined && typeof options.title !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'Directory picker title must be a string');
  }
  if (options.defaultPath !== undefined && typeof options.defaultPath !== 'string') {
    throw new MofoxError('INVALID_ARGUMENT', 'Directory picker defaultPath must be a string');
  }
  return options as DirectoryPickerOptions;
}

interface FilePickerFilter {
  name: string;
  extensions: string[];
}

/**
 * 在指定通道上注册 IPC 处理器，统一捕获异常并序列化为跨进程错误协议。
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
      // 对话框取消与系统错误统一序列化，避免暴露主进程异常对象。
      throw serializeIpcError(error);
    }
  });
}
