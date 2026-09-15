import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * 通过同目录临时文件和 rename 提交 JSON，避免读取方观察到只写入一半的配置文件。
 *
 * 写入失败时尽力回收临时文件，原目标文件保持未替换状态。
 *
 * @param path - 目标 JSON 文件路径。
 * @param value - 待序列化的任意值。
 * @throws {Error} 写入或 rename 失败时抛出（临时文件已清理）。
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    // 每次成功替换前保留上一版；目标首次创建时没有旧文件，ENOENT 可安全忽略。
    await copyFile(path, `${path}.bak`).catch((error: unknown) => {
      if (!hasErrorCode(error, 'ENOENT')) throw error;
    });
    await rename(temporaryPath, path);
  } catch (error) {
    // rename 或写入失败后尽力回收临时文件，原目标文件保持未替换状态。
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
