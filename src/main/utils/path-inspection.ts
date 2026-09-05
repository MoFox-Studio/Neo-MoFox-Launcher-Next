import { access, mkdir, rmdir, stat, statfs } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { PathInspection } from '../../shared/domain/manual-import';
import type { InstallTargetCheck } from '../../shared/domain/install';
import type { VenvPathInspection } from '../../shared/domain/venv';
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
 * 校验并规范化虚拟环境目录路径。
 *
 * 与主程序/平台目录不同，venv 目录允许尚不存在（首次同步依赖时由 uv 创建），
 * 因此只要求绝对路径；若路径已存在则必须是目录。
 *
 * @param value - 用户填写的 venv 目录路径。
 * @param label - 用于错误信息的字段名称。
 * @returns 规范化后的绝对目录路径。
 * @throws {MofoxError} 路径为空、非绝对路径或存在但非目录时抛出。
 */
export async function requireVenvDir(value: string, label: string): Promise<string> {
  const path = requireText(value, `${label}不能为空`);
  if (!isAbsolute(path)) throw new MofoxError('INVALID_ARGUMENT', `${label}必须是绝对路径`);
  const resolved = resolve(path);
  try {
    if ((await stat(resolved)).isDirectory()) return resolved;
    throw new MofoxError('INVALID_ARGUMENT', `${label}必须是目录`);
  } catch (error) {
    if (error instanceof MofoxError) throw error;
    // 目录不存在是允许的（uv 会在同步依赖时创建），返回规范化路径。
    return resolved;
  }
}

/**
 * 探测虚拟环境路径的绝对性、存在性、目录类型、有效性（`pyvenv.cfg`）与 Python 解释器。
 *
 * 供输入 venv 目录时即时反馈使用，不替代写入前的完整校验。
 *
 * @param value - 用户填写的 venv 目录路径。
 * @returns 非阻断的路径探测结果。
 */
export async function inspectVenvPath(value: string): Promise<VenvPathInspection> {
  const absolute = isAbsolute(value);
  if (!absolute) {
    return {
      absolute: false,
      exists: false,
      isDirectory: false,
      valid: false,
      pythonExists: false,
    };
  }
  const resolved = resolve(value);
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(resolved)).isDirectory();
  } catch {
    return { absolute: true, exists: false, isDirectory: false, valid: false, pythonExists: false };
  }
  if (!isDirectory) {
    return { absolute: true, exists: true, isDirectory: false, valid: false, pythonExists: false };
  }
  const [valid, pythonExists] = await Promise.all([
    fileExists(join(resolved, 'pyvenv.cfg')),
    fileExists(venvPythonPath(resolved)),
  ]);
  return { absolute: true, exists: true, isDirectory: true, valid, pythonExists };
}

/** venv 目录下按当前平台布局的 Python 解释器相对路径。 */
function venvPythonPath(venvDir: string): string {
  const layout = process.platform === 'win32' ? 'Scripts' : 'bin';
  const name = process.platform === 'win32' ? 'python.exe' : 'python3';
  return join(venvDir, layout, name);
}

/** 检查文件是否存在。 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 探测安装目标目录的可用性：所在盘符/文件系统的剩余空间与写入权限。
 *
 * 供安装向导在进入下一步前校验，不替代安装过程中对目录的最终检查。
 * 目录尚未创建时，会就近取第一个已存在的祖先目录进行权限与空间探测。
 *
 * @param value - 用户填写的安装目标路径。
 * @returns 路径的绝对性、存在性、目录类型、可写性与所在文件系统的空间信息。
 */
export async function inspectInstallTarget(value: string): Promise<InstallTargetCheck> {
  const absolute = isAbsolute(value);
  if (!absolute) {
    return {
      absolute: false,
      exists: false,
      isDirectory: false,
      writable: false,
      freeSpaceBytes: null,
      totalSpaceBytes: null,
    };
  }
  const resolved = resolve(value);
  let exists = false;
  let isDirectory = false;
  try {
    const entry = await stat(resolved);
    exists = true;
    isDirectory = entry.isDirectory();
  } catch {
    // 路径不存在时保持 exists=false。
  }
  const probePath = exists && isDirectory ? resolved : findExistingAncestor(resolved);
  const writable =
    exists && isDirectory && probePath !== null ? await canCreateDirectory(probePath) : false;
  const disk = probePath === null ? null : await readDiskSpace(probePath);
  return {
    absolute: true,
    exists,
    isDirectory,
    writable,
    freeSpaceBytes: disk?.freeSpaceBytes ?? null,
    totalSpaceBytes: disk?.totalSpaceBytes ?? null,
  };
}

/**
 * 自给定路径向上寻找第一个已存在的目录，用于对尚未创建的安装目录做空间探测。
 *
 * @param path - 待探测的绝对路径。
 * @returns 首个已存在的祖先目录；找不到时返回 `null`。
 */
function findExistingAncestor(path: string): string | null {
  let current = path;
  while (true) {
    if (isDirectorySync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** 同步判断路径是否为目录，用于向上回溯祖先目录时避免引入额外异步链路。 */
function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 通过在目录内临时创建并删除文件夹的方式，验证其是否具备新建目录的写入权限。
 *
 * @param directory - 待验证的目录绝对路径。
 * @returns 能成功创建并清理临时文件夹时返回 `true`。
 */
async function canCreateDirectory(directory: string): Promise<boolean> {
  const probe = join(
    directory,
    `.mofox-write-test-${Date.now()}-${randomBytes(4).toString('hex')}`,
  );
  try {
    await mkdir(probe);
    await rmdir(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取路径所在文件系统的可用空间与总空间。
 *
 * @param path - 文件系统上的任意路径。
 * @returns 空间字节数；探测失败时返回 `null`。
 */
async function readDiskSpace(path: string): Promise<{
  freeSpaceBytes: number | null;
  totalSpaceBytes: number | null;
}> {
  try {
    const stats = await statfs(path);
    const bsize = Number(stats.bsize);
    return {
      freeSpaceBytes: Number(stats.bavail) * bsize,
      totalSpaceBytes: Number(stats.blocks) * bsize,
    };
  } catch {
    return { freeSpaceBytes: null, totalSpaceBytes: null };
  }
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
