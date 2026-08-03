import { rm } from 'node:fs/promises';
import { parse, resolve } from 'node:path';
import { MofoxError } from '../../shared/domain/error';
import { nativeRemovalCommand } from './platform-helper';
import { runOneShot } from './process-service';

/**
 * 通过系统原生命令递归删除路径。
 *
 * Node 文件系统操作受限时使用；执行前会对路径做安全校验。
 *
 * @param path - 待删除的路径。
 * @throws {MofoxError} 路径非法或原生命令返回非零退出码时抛出。
 */
export async function removePathNative(path: string): Promise<void> {
  const target = validateRemovalPath(path);
  const command = nativeRemovalCommand(target);
  const result = await runOneShot(command.command, command.args, { timeoutMs: 60_000 });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `Native removal failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * 提供受路径保护的递归删除，Node fs.rm 失败时回退到平台原生命令。
 *
 * @param path - 待删除的路径。
 * @throws {MofoxError} 路径非法或最终删除失败时抛出。
 */
export async function removePathSafe(path: string): Promise<void> {
  const target = validateRemovalPath(path);
  try {
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Windows 锁定文件等场景可能使 fs.rm 失败，改由系统工具完成删除。
    await removePathNative(target);
  }
}

/**
 * 校验删除路径并解析为绝对路径，阻止对根目录与当前工作目录的递归删除。
 *
 * @param path - 待校验的原始路径。
 * @returns 解析后的绝对路径。
 * @throws {MofoxError} 路径为空、为根目录或为当前工作目录时抛出 `INVALID_ARGUMENT`。
 */
function validateRemovalPath(path: string): string {
  if (!path.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Removal path is required');
  const target = resolve(path);
  const root = parse(target).root;
  // 根目录和当前工作目录是高风险边界，禁止作为递归删除的目标。
  if (target === root || target === resolve(process.cwd())) {
    throw new MofoxError('INVALID_ARGUMENT', `Refusing to remove unsafe path: ${path}`);
  }
  return target;
}
