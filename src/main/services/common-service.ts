import { BrowserWindow, dialog } from 'electron';
import { resolve } from 'node:path';
import type {
  DirectoryPickerOptions,
  DirectoryPickerResult,
  FilePickerOptions,
  FilePickerResult,
} from '../../shared/domain/file-picker';
import type { PathInspection, PlatformPathInspection } from '../../shared/domain/manual-import';
import type { BotPlatform } from '../../shared/domain/bot-platform';
import { inspectPath } from '../utils/path-inspection';

/**
 * 通用服务能力契约：文件/文件夹选择与目录校验。
 * 目录校验与手动导入共用同一套检查，供渲染端在提交前即时反馈。
 */
export interface CommonService {
  pickFile(
    getWindow: () => BrowserWindow | null,
    options: FilePickerOptions | undefined,
  ): Promise<FilePickerResult>;
  pickDirectory(
    getWindow: () => BrowserWindow | null,
    options: DirectoryPickerOptions | undefined,
  ): Promise<DirectoryPickerResult>;
  inspectImportPath(value: string): Promise<PathInspection>;
  inspectPlatformPath(platformId: string, value: string): Promise<PlatformPathInspection>;
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

/**
 * 探测 Neo-MoFox 目录的状态，供用户输入目录时立即反馈。
 *
 * @param value - 用户在输入框内填写的路径。
 * @returns 路径的绝对性、存在性、目录类型与 main.py 标志。
 */
export async function inspectImportPath(value: string): Promise<PathInspection> {
  return inspectPath(value);
}

/**
 * 探测平台安装目录是否有效，与 Neo-MoFox 探测相互独立。
 *
 * 平台 ID 由调用方先选定，这里按该平台的启动入口探测目录；
 * 只用于提交前校验，实际写入时仍会对平台目录做一次完整核验。
 *
 * @param platforms - 按 ID 解析平台实例的注册表。
 * @param platformId - 所选平台的 ID。
 * @param value - 用户在输入框内填写的平台目录路径。
 * @returns 路径的绝对性、存在性与该平台的启动入口是否可解析。
 */
export async function inspectPlatformPath(
  platforms: { get(platformId: string): BotPlatform },
  platformId: string,
  value: string,
): Promise<PlatformPathInspection> {
  const inspection = await inspectPath(value);
  if (!inspection.absolute || !inspection.exists || !inspection.isDirectory) {
    return { ...inspection, valid: false };
  }
  const platform = platforms.get(platformId);
  let valid: boolean;
  try {
    await platform.getStartCommand(resolve(value));
    valid = true;
  } catch {
    valid = false;
  }
  return { ...inspection, valid };
}
