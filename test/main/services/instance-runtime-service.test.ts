import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import type { UpdateInstancePatch } from '../../../src/shared/domain/instance';
import { PlatformRegistry } from '../../../src/main/platforms/registry';
import { InstanceRuntimeService } from '../../../src/main/services/instance-runtime-service';
import { ProcessHelper, type ProcessHandle } from '../../../src/main/utils/process-helper';

// 测试 PTY 的 pid 为占位值，进程树终止统一走 tree-kill，这里替换为成功回调避免误杀真实进程。
vi.mock('tree-kill', () => ({
  default: (_pid: number, _signal: string, callback: (error?: Error) => void) => callback(),
}));

/** 覆盖进程生命周期、双进程状态收敛、PTY 状态同步与日志导出。 */
const FAST_TIMINGS = { sigterm: 10, sigkill: 10, batchAnswer: 5 };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function createPty() {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  const pty: ProcessHandle & {
    emitData(data: string): void;
    emitExit(exitCode: number): void;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  } = {
    pid: 1234,
    onData: vi.fn((listener: (data: string) => void) => {
      dataListener = listener;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
      exitListener = listener;
      return { dispose: vi.fn() };
    }),
    kill: vi.fn(() => {
      exitListener?.({ exitCode: 0 });
    }),
    write: vi.fn(),
    resize: vi.fn(),
    emitData: (data: string) => dataListener?.(data),
    emitExit: (exitCode: number) => exitListener?.({ exitCode }),
  };
  return pty;
}

describe('InstanceRuntimeService', () => {
  it('starts the platform process, forwards output and stops idempotently', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const registry = new PlatformRegistry([platform as never]);
    const pty = createPty();
    const factory = vi.fn(() => pty);
    const helper = new ProcessHelper(factory, FAST_TIMINGS);
    const events = { statusChanged: vi.fn(), ptyData: vi.fn() };
    const service = new InstanceRuntimeService(repository, registry, events, helper);

    await service.start(instance.id);
    await service.start(instance.id);
    pty.emitData('hello');
    await service.stop(instance.id);
    await service.stop(instance.id);

    // 幂等性体现为重复启动不会重复拉起进程，而不是避免重复解析命令。
    expect(factory).toHaveBeenCalledTimes(1);
    expect(events.ptyData).toHaveBeenCalledWith(instance.id, 'platform', 'hello');
    expect(repository.current.status).toBe('stopped');
  });

  it('starts both MoFox and the platform when main.py exists', async () => {
    const mofoxDir = await createMofoxDir();
    const instance = createInstance(mofoxDir);
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const spawned: string[] = [];
    const factory = vi.fn((command: string) => {
      spawned.push(command);
      return createPty();
    });
    const helper = new ProcessHelper(factory, FAST_TIMINGS);
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.start(instance.id);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(spawned.some((command) => command === 'uv' || command.includes('python'))).toBe(true);
    expect(spawned).toContain('bot');
    expect(repository.current.status).toBe('running');
    const stats = service.getStats(instance.id);
    expect(stats.mofox.running).toBe(true);
    expect(stats.platform.running).toBe(true);
    await service.stop(instance.id);
    expect(repository.current.status).toBe('stopped');
  });

  it('starts only the missing source when the instance is partially running', async () => {
    const mofoxDir = await createMofoxDir();
    const instance = createInstance(mofoxDir);
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const spawned: string[] = [];
    const factory = vi.fn((command: string) => {
      spawned.push(command);
      return createPty();
    });
    const helper = new ProcessHelper(factory, FAST_TIMINGS);
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.startSource(instance.id, 'platform');
    await service.start(instance.id);

    expect(spawned.filter((command) => command === 'bot')).toHaveLength(1);
    expect(spawned.some((command) => command === 'uv' || command.includes('python'))).toBe(true);
    expect(service.getStats(instance.id).mofox.running).toBe(true);
    expect(service.getStats(instance.id).platform.running).toBe(true);
    expect(repository.current.status).toBe('running');
    await service.stop(instance.id);
  });

  it('starts MoFox-only when the platform entry is missing', async () => {
    const mofoxDir = await createMofoxDir();
    const instance = createInstance(mofoxDir);
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => {
        throw new Error('no platform');
      }),
    };
    const helper = new ProcessHelper(
      vi.fn(() => createPty()),
      FAST_TIMINGS,
    );
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.start(instance.id);

    expect(service.getStats(instance.id).mofox.running).toBe(true);
    expect(service.getStats(instance.id).platform.running).toBe(false);
    await service.stop(instance.id);
  });

  it('keeps per-source log buffers and clears them independently', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const pty = createPty();
    const helper = new ProcessHelper(
      vi.fn(() => pty),
      FAST_TIMINGS,
    );
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.start(instance.id);
    pty.emitData('platform line\r\n');

    expect(service.getLogBuffer(instance.id, 'platform')).toContain('platform line');
    expect(service.getLogBuffer(instance.id, 'mofox')).not.toContain('platform line');
    service.clearLogBuffer(instance.id, 'platform');
    expect(service.getLogBuffer(instance.id, 'platform')).toBe('');
  });

  it('writes stdin and resizes the targeted PTY', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const pty = createPty();
    const factory = vi.fn(() => pty);
    const helper = new ProcessHelper(factory, FAST_TIMINGS);
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    service.resizePty(instance.id, 'platform', 100, 40);
    await service.start(instance.id);
    service.writePty(instance.id, 'platform', 'help\r');
    service.resizePty(instance.id, 'platform', 90, 30);

    expect(factory).toHaveBeenCalledWith(
      'bot',
      [],
      expect.objectContaining({ cols: 100, rows: 40 }),
    );
    expect(pty.write).toHaveBeenCalledWith('help\r');
    expect(pty.resize).toHaveBeenCalledWith(90, 30);
  });

  it('restart stops then starts again', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const helper = new ProcessHelper(
      vi.fn(() => createPty()),
      FAST_TIMINGS,
    );
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.start(instance.id);
    await service.restart(instance.id);

    expect(platform.getStartCommand).toHaveBeenCalledTimes(2);
    expect(repository.current.status).toBe('running');
  });

  it('starts a single process source independently', async () => {
    const mofoxDir = await createMofoxDir();
    const instance = createInstance(mofoxDir);
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const spawned: string[] = [];
    const factory = vi.fn((command: string) => {
      spawned.push(command);
      return createPty();
    });
    const helper = new ProcessHelper(factory, FAST_TIMINGS);
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.startSource(instance.id, 'mofox');

    expect(factory).toHaveBeenCalledTimes(1);
    expect(spawned.some((command) => command === 'uv' || command.includes('python'))).toBe(true);
    expect(repository.current.status).toBe('running');
    expect(service.getStats(instance.id).mofox.running).toBe(true);
    expect(service.getStats(instance.id).platform.running).toBe(false);
    await service.stop(instance.id);
  });

  it('stops a single source while the other keeps the instance running', async () => {
    const mofoxDir = await createMofoxDir();
    const instance = createInstance(mofoxDir);
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const helper = new ProcessHelper(
      vi.fn(() => createPty()),
      FAST_TIMINGS,
    );
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.start(instance.id);
    await service.stopSource(instance.id, 'platform');

    expect(service.getStats(instance.id).mofox.running).toBe(true);
    expect(service.getStats(instance.id).platform.running).toBe(false);
    expect(repository.current.status).toBe('running');

    await service.stopSource(instance.id, 'mofox');
    expect(repository.current.status).toBe('stopped');
  });

  it('restarts a single process source', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const helper = new ProcessHelper(
      vi.fn(() => createPty()),
      FAST_TIMINGS,
    );
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.startSource(instance.id, 'platform');
    await service.restartSource(instance.id, 'platform');

    expect(platform.getStartCommand).toHaveBeenCalledTimes(2);
    expect(service.getStats(instance.id).platform.running).toBe(true);
    await service.stop(instance.id);
  });

  it('rejects starting a source without an install entry', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const helper = new ProcessHelper(
      vi.fn(() => createPty()),
      FAST_TIMINGS,
    );
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await expect(service.startSource(instance.id, 'mofox')).rejects.toThrow(
      '实例未配置 MoFox 本体目录',
    );
    expect(repository.current.status).toBe('stopped');
    expect(service.getStats(instance.id).mofox.running).toBe(false);
  });

  it('exports ANSI-stripped logs through the injected writer', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const pty = createPty();
    const helper = new ProcessHelper(
      vi.fn(() => pty),
      FAST_TIMINGS,
    );
    const writeExport = vi.fn(
      async (fileName: string, _content: string) => `D:\\exports\\${fileName}`,
    );
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
      writeExport,
    );

    await service.start(instance.id);
    pty.emitData('\x1b[32mcolored\x1b[0m output\r\n');
    const path = await service.exportLogs(instance.id, 'platform');

    expect(path).toMatch(/^D:\\exports\\/);
    const content = writeExport.mock.calls[0]?.[1] as string;
    expect(content).toContain('colored output');
    expect(content).not.toContain('\x1b');
  });

  it('marks the instance as error when the process exits abnormally', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = {
      id: 'test',
      getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })),
    };
    const pty = createPty();
    const helper = new ProcessHelper(
      vi.fn(() => pty),
      FAST_TIMINGS,
    );
    const service = new InstanceRuntimeService(
      repository,
      new PlatformRegistry([platform as never]),
      { statusChanged: vi.fn(), ptyData: vi.fn() },
      helper,
    );

    await service.start(instance.id);
    pty.emitExit(1);
    await vi.waitFor(() => expect(repository.current.status).toBe('error'));
  });
});

function createInstance(installPath = 'D:\\Bot'): Instance {
  return {
    id: 'one',
    name: 'One',
    mofoxInstallDir: installPath,
    platform: { id: 'test', installDir: installPath, version: '1' },
    status: 'stopped',
    createdAt: 1,
    lastStartedAt: null,
    autoStart: false,
  };
}

async function createMofoxDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mofox-runtime-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'neo-mofox'), { recursive: true });
  const mofoxDir = join(root, 'neo-mofox');
  await writeFile(join(mofoxDir, 'main.py'), 'print("hi")');
  return mofoxDir;
}

function createRepository(instance: Instance) {
  return {
    current: { ...instance },
    list: vi.fn(async function (this: { current: Instance }) {
      return [this.current];
    }),
    update: vi.fn(async function (
      this: { current: Instance },
      _id: string,
      patch: UpdateInstancePatch,
    ) {
      this.current = { ...this.current, ...patch };
      return this.current;
    }),
  };
}
