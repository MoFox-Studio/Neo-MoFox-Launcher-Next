import { rm } from 'node:fs/promises';
import { parse, resolve } from 'node:path';
import { MofoxError } from '../../shared/domain/error';
import { nativeRemovalCommand } from './platform-helper';
import { runOneShot } from './process-service';

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
    await removePathNative(target);
  }
}

function validateRemovalPath(path: string): string {
  if (!path.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Removal path is required');
  const target = resolve(path);
  const root = parse(target).root;
  if (target === root || target === resolve(process.cwd())) {
    throw new MofoxError('INVALID_ARGUMENT', `Refusing to remove unsafe path: ${path}`);
  }
  return target;
}