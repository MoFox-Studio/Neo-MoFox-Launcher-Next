import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallRequest } from '../../../src/shared/domain/install';
import type { MirrorSource } from '../../../src/shared/domain/mirror';
import type { InstallTaskContext } from '../../../src/main/utils/install-tasks';
import { PlatformRegistry } from '../../../src/main/platforms/registry';
import { InstallTaskService } from '../../../src/main/services/install-task-service';

/** 覆盖流水线编排：临时目录逐级复制、条件步骤、失败重试、取消清理与进度事件。 */
const temporaryDirectories: string[] = [];

const TEST_MIRRORS: readonly MirrorSource[] = [
  { id: 'gh-direct', type: 'github', name: 'GitHub', baseUrl: 'https://github.com' },
];

const mirrorsProvider = { list: () => [...TEST_MIRRORS] };

// 编排服务会按请求解析平台实例；测试覆盖执行器但未安装真实平台，因此注入最小桩平台。
const platformStub = {
  id: 'test',
  name: 'Test',
  description: 'Test',
  supportedPlatforms: ['win32'] as Array<'win32' | 'linux' | 'darwin'>,
  supportedArch: ['x64'] as Array<'x64' | 'arm64'>,
  latestVersion: '2.0.0',
  install: vi.fn(),
  configure: vi.fn(),
  update: vi.fn(),
  getLatestVersion: vi.fn(),
  getStartCommand: vi.fn(),
  isAvailable: vi.fn(),
};

function registry(): PlatformRegistry {
  return new PlatformRegistry([platformStub]);
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('InstallTaskService', () => {
  it('installs in a temporary directory, finalizes, and persists only after success', async () => {
    const root = await createTempRoot();
    const target = join(root, 'installed');
    const repository = { create: vi.fn(async () => undefined) };
    const executors = {
      'install-mofox': async (ctx: InstallTaskContext) => {
        await mkdir(join(ctx.stageDir, 'mofox', 'config'), { recursive: true });
        await writeFile(join(ctx.stageDir, 'mofox', 'main.py'), 'main');
        await writeFile(join(ctx.stageDir, 'mofox', 'config', 'core.toml'), 'core');
      },
      'install-platform': async (ctx: InstallTaskContext) => {
        await mkdir(join(ctx.stageDir, 'platform'), { recursive: true });
        await writeFile(join(ctx.stageDir, 'platform', 'ready.txt'), 'ready');
        return { version: '2.0.0' };
      },
      'install-webui': async () => undefined,
      configure: async () => undefined,
    };
    const progress = vi.fn();
    const service = new InstallTaskService(
      registry(),
      { repository, mirrors: mirrorsProvider, executors },
      { progress },
    );

    const taskId = await service.start(request(target));
    await service.wait(taskId);

    // 安装落在「目标目录 / 实例 ID 子文件夹」内，而非直接写入目标目录。
    const instanceDir = join(target, taskId);
    expect(await readFile(join(instanceDir, 'mofox', 'main.py'), 'utf8')).toBe('main');
    expect(await readFile(join(instanceDir, 'platform', 'ready.txt'), 'utf8')).toBe('ready');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: taskId,
        name: 'Test',
        mofoxInstallDir: join(instanceDir, 'mofox'),
        platform: { id: 'test', installDir: join(instanceDir, 'platform'), version: '2.0.0' },
      }),
    );
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'done', step: 'finalize' }),
    );
  });

  it('copies the working folder between steps so each executor starts from a fresh snapshot', async () => {
    const root = await createTempRoot();
    const target = join(root, 'installed');
    const seen = { webuiSawPlatform: false, configureSawMofox: false, configureSawPlatform: false };
    const executors = {
      'install-mofox': async (ctx: InstallTaskContext) => {
        await writeFile(join(ctx.stageDir, 'mofox.txt'), 'mofox');
      },
      'install-platform': async (ctx: InstallTaskContext) => {
        await writeFile(join(ctx.stageDir, 'platform.txt'), 'platform');
      },
      'install-webui': async (ctx: InstallTaskContext) => {
        // 上一步（平台）的产物必须已通过复制进入本步骤快照。
        seen.webuiSawPlatform = await exists(join(ctx.stageDir, 'platform.txt'));
        await writeFile(join(ctx.stageDir, 'webui.txt'), 'webui');
      },
      configure: async (ctx: InstallTaskContext) => {
        seen.configureSawMofox = await exists(join(ctx.stageDir, 'mofox.txt'));
        seen.configureSawPlatform = await exists(join(ctx.stageDir, 'platform.txt'));
        await writeFile(join(ctx.stageDir, 'configured.txt'), 'ok');
      },
    };
    const service = new InstallTaskService(
      registry(),
      { repository: { create: vi.fn() }, mirrors: mirrorsProvider, executors },
      { progress: vi.fn() },
    );

    const taskId = await service.start(request(target));
    await service.wait(taskId);

    expect(seen.webuiSawPlatform).toBe(true);
    expect(seen.configureSawMofox).toBe(true);
    expect(seen.configureSawPlatform).toBe(true);
  });

  it('skips optional platform and webui steps when not selected', async () => {
    const root = await createTempRoot();
    const target = join(root, 'installed');
    const calls: string[] = [];
    const executors = {
      'install-mofox': async (ctx: InstallTaskContext) => {
        calls.push('mofox');
        await writeFile(join(ctx.stageDir, 'mofox.txt'), 'm');
      },
      'install-platform': async () => {
        calls.push('platform');
      },
      'install-webui': async () => {
        calls.push('webui');
      },
      configure: async () => {
        calls.push('configure');
      },
    };
    const service = new InstallTaskService(
      registry(),
      { repository: { create: vi.fn() }, mirrors: mirrorsProvider, executors },
      { progress: vi.fn() },
    );

    const taskId = await service.start(request(target, { platformId: '', installWebui: false }));
    await service.wait(taskId);

    expect(calls).toEqual(['mofox', 'configure']);
  });

  it('retries a failed task by resuming from the failed step instead of restarting', async () => {
    const root = await createTempRoot();
    const target = join(root, 'installed');
    const calls: string[] = [];
    let configureCalls = 0;
    const executors = {
      'install-mofox': async (ctx: InstallTaskContext) => {
        calls.push('mofox');
        await mkdir(join(ctx.stageDir, 'mofox'), { recursive: true });
        await writeFile(join(ctx.stageDir, 'mofox', 'mofox.txt'), 'm');
      },
      configure: async (ctx: InstallTaskContext) => {
        calls.push('configure');
        configureCalls += 1;
        if (configureCalls === 1) throw new Error('config failed');
        await writeFile(join(ctx.stageDir, 'mofox', 'ok.txt'), 'ok');
      },
    };
    const progress = vi.fn();
    const service = new InstallTaskService(
      registry(),
      { repository: { create: vi.fn() }, mirrors: mirrorsProvider, executors },
      { progress },
    );

    const taskId = await service.start(request(target, { platformId: '', installWebui: false }));
    await service.wait(taskId);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));
    // 失败保留工作区（位于实例目录下），供重试从断点续跑。
    await expect(access(join(target, taskId))).resolves.toBeUndefined();

    await service.retry(taskId);

    // 已完成的步骤不重复执行，仅续跑失败的配置步骤并最终落地。
    expect(calls).toEqual(['mofox', 'configure', 'configure']);
    expect(await readFile(join(target, taskId, 'mofox', 'ok.txt'), 'utf8')).toBe('ok');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('resumes from the next step when the copy between steps failed', async () => {
    const root = await createTempRoot();
    const target = join(root, 'installed');
    const calls: string[] = [];
    let configureCalls = 0;
    const executors = {
      'install-mofox': async (ctx: InstallTaskContext) => {
        calls.push('mofox');
        await mkdir(join(ctx.stageDir, 'mofox'), { recursive: true });
        await writeFile(join(ctx.stageDir, 'mofox', 'mofox.txt'), 'm');
        // 把下一步快照路径占位成普通文件，让流水线的「复制给下一步」动作失败。
        await writeFile(join(dirname(ctx.stageDir), 'stage-1'), 'block');
      },
      configure: async (ctx: InstallTaskContext) => {
        calls.push('configure');
        configureCalls += 1;
        // 断点续跑时应从上一步完成品重新复制，配置步骤能看到 mofox 产物。
        expect(await exists(join(ctx.stageDir, 'mofox', 'mofox.txt'))).toBe(true);
        await writeFile(join(ctx.stageDir, 'mofox', 'ok.txt'), 'ok');
      },
    };
    const progress = vi.fn();
    const service = new InstallTaskService(
      registry(),
      { repository: { create: vi.fn() }, mirrors: mirrorsProvider, executors },
      { progress },
    );

    const taskId = await service.start(request(target, { platformId: '', installWebui: false }));
    await service.wait(taskId);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }));

    await service.retry(taskId);

    // 复制失败时已完成的步骤不再执行，重试撤销残留并续跑下一步。
    expect(calls).toEqual(['mofox', 'configure']);
    expect(configureCalls).toBe(1);
    expect(await readFile(join(target, taskId, 'mofox', 'ok.txt'), 'utf8')).toBe('ok');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'done' }));
  });

  it('retries the first step from a clean snapshot when it fails', async () => {
    const root = await createTempRoot();
    const target = join(root, 'installed');
    let mofoxCalls = 0;
    const executors = {
      'install-mofox': async (ctx: InstallTaskContext) => {
        mofoxCalls += 1;
        // 首次执行留下残留产物后失败，重试应清除残留再从头开始该步骤。
        if (mofoxCalls === 1) {
          await mkdir(join(ctx.stageDir, 'mofox'), { recursive: true });
          await writeFile(join(ctx.stageDir, 'mofox', 'partial.txt'), 'junk');
          throw new Error('mofox download failed');
        }
        await mkdir(join(ctx.stageDir, 'mofox'), { recursive: true });
        await writeFile(join(ctx.stageDir, 'mofox', 'mofox.txt'), 'm');
      },
    };
    const service = new InstallTaskService(
      registry(),
      { repository: { create: vi.fn() }, mirrors: mirrorsProvider, executors },
      { progress: vi.fn() },
    );

    const taskId = await service.start(request(target, { platformId: '', installWebui: false }));
    await service.wait(taskId);

    await service.retry(taskId);

    expect(mofoxCalls).toBe(2);
    // 残留的 partial.txt 已被撤销，最终落地只有干净产物。
    await expect(access(join(target, taskId, 'mofox', 'mofox.txt'))).resolves.toBeUndefined();
    await expect(access(join(target, taskId, 'mofox', 'partial.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('aborts an active install and removes its temporary workspace', async () => {
    const root = await createTempRoot();
    let stageDir = '';
    const executors = {
      'install-mofox': async (ctx: InstallTaskContext) => {
        stageDir = ctx.stageDir;
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        throw new Error('aborted');
      },
    };
    const progress = vi.fn();
    const service = new InstallTaskService(
      registry(),
      { repository: { create: vi.fn() }, mirrors: mirrorsProvider, executors },
      { progress },
    );

    const taskId = await service.start(request(join(root, 'installed')));
    await service.cancel(taskId);

    await expect(access(stageDir)).rejects.toMatchObject({ code: 'ENOENT' });
    // 取消时回收实例目录（缓存工作区），目标目录本身保留为空文件夹。
    await expect(access(join(root, 'installed', taskId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  it('passes the configured mirror list through to executors', async () => {
    const root = await createTempRoot();
    let received: readonly MirrorSource[] = [];
    const executors = {
      'install-mofox': async (ctx: InstallTaskContext) => {
        received = ctx.mirrors;
        await writeFile(join(ctx.stageDir, 'mofox.txt'), 'm');
      },
    };
    const service = new InstallTaskService(
      registry(),
      { repository: { create: vi.fn() }, mirrors: mirrorsProvider, executors },
      { progress: vi.fn() },
    );

    const taskId = await service.start(request(join(root, 'installed')));
    await service.wait(taskId);

    expect(received).toEqual(TEST_MIRRORS);
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'mofox-install-test-'));
  temporaryDirectories.push(path);
  return path;
}

function request(targetDir: string, overrides: Partial<InstallRequest> = {}): InstallRequest {
  return {
    instanceName: 'Test',
    platformId: 'test',
    mofoxBranch: 'main',
    wsPort: 8095,
    botQQ: '12345678901',
    botNickname: '灵语雪',
    ownerQQ: '12345678901',
    apiKey: 'sk-test-1234',
    installWebui: true,
    webuiApiKey: 'abcdefgh',
    targetDir,
    ...overrides,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
