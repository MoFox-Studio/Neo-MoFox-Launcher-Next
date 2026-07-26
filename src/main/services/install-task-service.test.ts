import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotPlatform } from '../../shared/domain/bot-platform';
import { PlatformRegistry } from '../platforms/registry';
import { InstallTaskService } from './install-task-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('InstallTaskService', () => {
  it('installs in a temporary directory, finalizes, and persists only after success', async () => {
    const root = await createTempRoot();
    const target = join(root, 'installed');
    const repository = { upsert: vi.fn(async () => undefined) };
    const platform = createPlatform(async (context) => {
      const payload = join(context.workDir, 'payload');
      await mkdir(payload, { recursive: true });
      await writeFile(join(payload, 'ready.txt'), 'ready');
      return { version: '2.0.0', installPath: payload };
    });
    const progress = vi.fn();
    const service = new InstallTaskService(new PlatformRegistry([platform]), { repository, tempRoot: root, now: () => 42 }, { progress });

    const taskId = await service.start(request(target));
    await service.wait(taskId);

    expect(await readFile(join(target, 'ready.txt'), 'utf8')).toBe('ready');
    expect(repository.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: taskId, installPath: target, createdAt: 42 }));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'done', step: 'finalize' }));
  });

  it('retries the failed configure step without downloading again', async () => {
    const root = await createTempRoot();
    const install = vi.fn(async (context) => {
      const payload = join(context.workDir, 'payload');
      await mkdir(payload, { recursive: true });
      await writeFile(join(payload, 'ready.txt'), 'ready');
      return { version: '2.0.0', installPath: payload };
    });
    const platform = createPlatform(install);
    platform.configure = vi.fn().mockRejectedValueOnce(new Error('config failed')).mockResolvedValue(undefined);
    const progress = vi.fn();
    const service = new InstallTaskService(new PlatformRegistry([platform]), { repository: { upsert: vi.fn() }, tempRoot: root }, { progress });

    const taskId = await service.start(request(join(root, 'installed')));
    await service.wait(taskId);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed', step: 'configure' }));

    await service.retry(taskId);

    expect(install).toHaveBeenCalledTimes(1);
    expect(platform.configure).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('aborts an active platform install and removes its temporary directory', async () => {
    const root = await createTempRoot();
    let workDir = '';
    const platform = createPlatform(async (context) => {
      workDir = context.workDir;
      await new Promise<void>((resolve) => context.signal?.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('aborted');
    });
    const progress = vi.fn();
    const service = new InstallTaskService(new PlatformRegistry([platform]), { repository: { upsert: vi.fn() }, tempRoot: root }, { progress });

    const taskId = await service.start(request(join(root, 'installed')));
    await service.cancel(taskId);

    await expect(access(workDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'mofox-install-test-'));
  temporaryDirectories.push(path);
  return path;
}

function request(targetDir: string) {
  return { instanceName: 'Test', platformId: 'test', version: 'latest', targetDir };
}

function createPlatform(install: BotPlatform['install']): BotPlatform {
  return {
    id: 'test', name: 'Test', description: 'Test', supportedPlatforms: ['win32'], supportedArch: ['x64'], latestVersion: '2.0.0',
    install,
    configure: vi.fn(async () => undefined),
    update: vi.fn(),
    getLatestVersion: vi.fn(async () => '2.0.0'),
    getStartCommand: vi.fn(),
    isAvailable: vi.fn(),
  };
}