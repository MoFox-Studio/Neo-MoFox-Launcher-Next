import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// 通过同目录临时文件和 rename 提交 JSON，避免读取方观察到只写入一半的配置文件。
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
  } catch (error) {
    // rename 或写入失败后尽力回收临时文件，原目标文件保持未替换状态。
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
