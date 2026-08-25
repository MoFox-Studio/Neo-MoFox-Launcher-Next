import { access, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { PathInspection } from '../../shared/domain/manual-import';
import { MofoxError } from '../../shared/domain/error';

/**
 * 校验并规范化目录路径，拒绝不存在或非目录的用户输入。
 *
 * 手动导入与实例管理共用此检查，确保写入持久化层的路径都是可用的绝对目录。
 *
 * @param value - 用户填写的目录路径。
 * @param label - 用于错误信息的字段名称。
 * @returns 规范化后的绝对目录路径。
 * @throws {MofoxError} 路径为空、非绝对路径、不存在或不是目录时抛出。
 */
export async function requireDirectory(value: string, label: string): Promise<string> {
  const path = requireText(value, `${label}不能为空`);
  if (!isAbsolute(path)) throw new MofoxError('INVALID_ARGUMENT', `${label}必须是绝对路径`);
  const resolved = resolve(path);
  try {
    if (!(await stat(resolved)).isDirectory()) {
      throw new MofoxError('INVALID_ARGUMENT', `${label}必须是目录`);
    }
  } catch (error) {
    if (error instanceof MofoxError) throw error;
    throw new MofoxError('NOT_FOUND', `${label}不存在: ${resolved}`);
  }
  return resolved;
}

/**
 * 校验文件存在且为普通文件，用于确认目录中具备预期的入口文件。
 *
 * @param path - 待检查的文件绝对路径。
 * @param message - 文件缺失时抛出的可读错误信息。
 * @throws {MofoxError} 文件不存在或不是普通文件时抛出 `NOT_FOUND`。
 */
export async function requireFile(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new MofoxError('NOT_FOUND', message);
  } catch (error) {
    if (error instanceof MofoxError) throw error;
    throw new MofoxError('NOT_FOUND', message);
  }
}

/**
 * 探测路径的绝对性、存在性、目录类型与 main.py 标志。
 *
 * 供输入目录时即时反馈使用，不替代写入前的完整校验。
 *
 * @param value - 用户填写的路径。
 * @returns 路径的绝对性、存在性、目录类型与 main.py 标志。
 */
export async function inspectPath(value: string): Promise<PathInspection> {
  const absolute = isAbsolute(value);
  if (!absolute) {
    return { absolute: false, exists: false, isDirectory: false, mainPyExists: false };
  }
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(value)).isDirectory();
  } catch {
    return { absolute: true, exists: false, isDirectory: false, mainPyExists: false };
  }
  let mainPyExists = false;
  if (isDirectory) {
    try {
      await access(join(value, 'main.py'));
      mainPyExists = true;
    } catch {
      mainPyExists = false;
    }
  }
  return { absolute: true, exists: true, isDirectory, mainPyExists };
}

/**
 * Windows 文件系统路径不区分大小写，其余平台按原始规范化路径比较。
 *
 * @param left - 参与比较的路径。
 * @param right - 参与比较的路径。
 * @returns 两个路径指向同一位置时返回 `true`。
 */
export function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === right.toLowerCase()
    : normalizedLeft === right;
}

/** 确保必填文本在进入检查前已经去除首尾空白。 */
function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new MofoxError('INVALID_ARGUMENT', message);
  return trimmed;
}
