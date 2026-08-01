import { rm } from 'node:fs/promises';
import { parse, resolve } from 'node:path';
import { MofoxError } from '../../shared/domain/error';
import { nativeRemovalCommand } from './platform-helper';
import { runOneShot } from './process-service';

// 提供受路径保护的递归删除；Node 文件系统操作受限时可退回平台原生命令。
export async function removePathNative(path: string): Promise<void> {
  const target = validateRemovalPath(path);
  const command = nativeRemovalCommand(target);
  const result = await runOneShot(command.command, command.args, { timeoutMs: 60_000 });
  if (result.exitCode !== 0) {
    throw new MofoxError('IO_ERROR', `Native removal failed: ${result.stderr || result.stdout}`);
  }
}

export async function removePathSafe(path: string): Promise<void> {
  const target = validateRemovalPath(path);
  try {
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Windows 锁定文件等场景可能使 fs.rm 失败，改由系统工具完成删除。
    await removePathNative(target);
  }
}

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
