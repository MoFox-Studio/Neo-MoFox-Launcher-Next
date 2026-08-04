import { BrowserWindow, dialog } from 'electron';
import type {
  DirectoryPickerOptions,
  DirectoryPickerResult,
  FilePickerOptions,
  FilePickerResult,
} from '../../shared/domain/file-picker';

/**
 * 通用文件/文件夹选择服务：包装 Electron `dialog`，并归一化结果为 IPC 契约类型。
 * 窗口不存在或已销毁时返回 `null`，避免在启动/关闭阶段触发无效对话框。
 */
export interface FilePickerService {
  pickFile(
    getWindow: () => BrowserWindow | null,
    options: FilePickerOptions | undefined,
  ): Promise<FilePickerResult>;
  pickDirectory(
    getWindow: () => BrowserWindow | null,
    options: DirectoryPickerOptions | undefined,
  ): Promise<DirectoryPickerResult>;
}

/**
 * 调用 Electron `dialog` 选择文件，并将其归一化为 `FilePickerResult`。
 *
 * 窗口不存在或已销毁时返回 `null`，避免在启动或关闭阶段触发起无效的对话框。
 *
 * @param getWindow - 返回当前主窗口的回调；窗口不存在时返回 `null`。
 * @param options - 渲染端传入的文件选择器选项。
 * @returns 选中路径数组，或 `null` 表示用户取消/无可附着窗口。
 */
export async function pickFile(
  getWindow: () => BrowserWindow | null,
  options: FilePickerOptions | undefined,
): Promise<FilePickerResult> {
  const window = getWindow();
  if (!window || window.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(window, {
    title: options?.title,
    defaultPath: options?.defaultPath,
    filters: options?.filters,
    properties: [options?.multiSelections ? 'multiSelections' : 'openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
}

/**
 * 调用 Electron `dialog` 选择文件夹，并将其归一化为 `DirectoryPickerResult`。
 *
 * 窗口不存在或已销毁时返回 `null`，避免在启动或关闭阶段触发起无效的对话框。
 *
 * @param getWindow - 返回当前主窗口的回调；窗口不存在时返回 `null`。
 * @param options - 渲染端传入的文件夹选择器选项。
 * @returns 选中路径，或 `null` 表示用户取消/无可附着窗口。
 */
export async function pickDirectory(
  getWindow: () => BrowserWindow | null,
  options: DirectoryPickerOptions | undefined,
): Promise<DirectoryPickerResult> {
  const window = getWindow();
  if (!window || window.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(window, {
    title: options?.title,
    defaultPath: options?.defaultPath,
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}
