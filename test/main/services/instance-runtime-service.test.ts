import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import { PlatformRegistry } from '../../../src/main/platforms/registry';
import { InstanceRuntimeService, type PtyProcess } from '../../../src/main/services/instance-runtime-service';

/** 覆盖进程生命周期、双进程状态收敛、PTY 状态同步、日志导出和删除前停机。 */
const FAST_TIMINGS = { sigterm: 10, sigkill: 10 };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('InstanceRuntimeService', () => {
  it('starts the platform process, forwards output and stops idempotently', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = { id: 'test', getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })) };
    const registry = new PlatformRegistry([platform as never]);
    const pty = createPty();
    const events = { statusChanged: vi.fn(), ptyData: vi.fn() };
    const service = new InstanceRuntimeService(repository, registry, events, vi.fn(() => pty), undefined, undefined, undefined, FAST_TIMINGS);

    await service.start(instance.id);
    await service.start(instance.id);
    pty.emitData('hello');
    await service.stop(instance.id);
    await service.stop(instance.id);

    expect(platform.getStartCommand).toHaveBeenCalledTimes(1);
    expect(events.ptyData).toHaveBeenCalledWith(instance.id, 'platform', 'hello');
    expect(repository.current.status).toBe('stopped');
  });

  it('starts both MoFox and the platform when main.py exists', async () => {
    const mofoxDir = await createMofoxDir();
    const instance = createInstance(mofoxDir);
    const repository = createRepository(instance);
    const platform = { id: 'test', getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })) };
    const spawned: string[] = [];
    const factory = vi.fn((command: string) => { spawned.push(command); return createPty(); });
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([platform as never]), { statusChanged: vi.fn(), ptyData: vi.fn() }, factory, undefined, undefined, undefined, FAST_TIMINGS);

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

  it('starts MoFox-only when the platform entry is missing', async () => {
    const mofoxDir = await createMofoxDir();
    const instance = createInstance(mofoxDir);
    const repository = createRepository(instance);
    const platform = { id: 'test', getStartCommand: vi.fn(async () => { throw new Error('no platform'); }) };
    const factory = vi.fn(() => createPty());
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([platform as never]), { statusChanged: vi.fn(), ptyData: vi.fn() }, factory, undefined, undefined, undefined, FAST_TIMINGS);

    await service.start(instance.id);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(service.getStats(instance.id).mofox.running).toBe(true);
    expect(service.getStats(instance.id).platform.running).toBe(false);
    await service.stop(instance.id);
  });

  it('updates paths only while the instance is stopped', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = { id: 'test', getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })) };
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([platform as never]), { statusChanged: vi.fn(), ptyData: vi.fn() }, vi.fn(() => createPty()), undefined, undefined, undefined, FAST_TIMINGS);

    await expect(service.updatePaths(instance.id, {
      mofoxInstallDir: 'D:\\MoFox',
      platforms: { snowluma: 'E:\\SnowLuma' },
    })).resolves.toMatchObject({
      mofoxInstallDir: 'D:\\MoFox',
      platforms: { snowluma: 'E:\\SnowLuma' },
    });
    expect(repository.current.mofoxInstallDir).toBe('D:\\MoFox');

    repository.current.status = 'running';
    await expect(service.updatePaths(instance.id, {
      mofoxInstallDir: 'D:\\Other',
      platforms: { snowluma: 'E:\\Other' },
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps per-source log buffers and clears them independently', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = { id: 'test', getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })) };
    const pty = createPty();
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([platform as never]), { statusChanged: vi.fn(), ptyData: vi.fn() }, vi.fn(() => pty), undefined, undefined, undefined, FAST_TIMINGS);

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
    const platform = { id: 'test', getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })) };
    const pty = createPty();
    const factory = vi.fn(() => pty);
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([platform as never]), { statusChanged: vi.fn(), ptyData: vi.fn() }, factory, undefined, undefined, undefined, FAST_TIMINGS);

    service.resizePty(instance.id, 'platform', 100, 40);
    await service.start(instance.id);
    service.writePty(instance.id, 'platform', 'help\r');
    service.resizePty(instance.id, 'platform', 90, 30);

    expect(factory).toHaveBeenCalledWith('bot', [], expect.objectContaining({ cols: 100, rows: 40 }));
    expect(pty.write).toHaveBeenCalledWith('help\r');
    expect(pty.resize).toHaveBeenCalledWith(90, 30);
  });

  it('restart stops then starts again', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = { id: 'test', getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })) };
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([platform as never]), { statusChanged: vi.fn(), ptyData: vi.fn() }, vi.fn(() => createPty()), undefined, undefined, undefined, FAST_TIMINGS);

    await service.start(instance.id);
    await service.restart(instance.id);

    expect(platform.getStartCommand).toHaveBeenCalledTimes(2);
    expect(repository.current.status).toBe('running');
  });

  it('exports ANSI-stripped logs through the injected writer', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = { id: 'test', getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })) };
    const pty = createPty();
    const writeExport = vi.fn(async (fileName: string, _content: string) => `D:\\exports\\${fileName}`);
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([platform as never]), { statusChanged: vi.fn(), ptyData: vi.fn() }, vi.fn(() => pty), undefined, undefined, writeExport, FAST_TIMINGS);

    await service.start(instance.id);
    pty.emitData('\x1b[32mcolored\x1b[0m output\r\n');
    const path = await service.exportLogs(instance.id, 'platform');

    expect(path).toMatch(/^D:\\exports\\/);
    const content = writeExport.mock.calls[0]?.[1] ?? '';
    expect(content).toContain('colored output');
    expect(content).not.toContain('\x1b');
  });

  it('marks the instance as error when the process exits abnormally', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const platform = { id: 'test', getStartCommand: vi.fn(async () => ({ command: 'bot', args: [], cwd: 'D:\\Bot' })) };
    const pty = createPty();
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([platform as never]), { statusChanged: vi.fn(), ptyData: vi.fn() }, vi.fn(() => pty), undefined, undefined, undefined, FAST_TIMINGS);

    await service.start(instance.id);
    pty.emitExit(1);
    await vi.waitFor(() => expect(repository.current.status).toBe('error'));
  });

  it('stops before removing files and the repository record', async () => {
    const repository = createRepository(createInstance());
    const removePath = vi.fn(async () => undefined);
    const service = new InstanceRuntimeService(repository, new PlatformRegistry([]), { statusChanged: vi.fn(), ptyData: vi.fn() }, undefined, removePath, undefined, undefined, FAST_TIMINGS);

    await service.remove('one');

    expect(removePath).toHaveBeenCalledWith(repository.current.mofoxInstallDir);
    expect(repository.remove).toHaveBeenCalledWith('one');
  });
});

function createInstance(installPath = 'D:\\Bot'): Instance {
  return {
    id: 'one',
    name: 'One',
    version: '1',
    mofoxInstallDir: installPath,
    platforms: { test: installPath },
    status: 'stopped',
    createdAt: 1,
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

function createPty() {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | undefined;
  const pty: PtyProcess & {
    emitData(data: string): void;
    emitExit(exitCode: number): void;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  } = {
    pid: 1234,
    onData: vi.fn((listener: (data: string) => void) => { dataListener = listener; return { dispose: vi.fn() }; }),
    onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => { exitListener = listener; return { dispose: vi.fn() }; }),
    kill: vi.fn(() => { exitListener?.({ exitCode: 0 }); }),
    write: vi.fn(),
    resize: vi.fn(),
    emitData: (data: string) => dataListener?.(data),
    emitExit: (exitCode: number) => exitListener?.({ exitCode }),
  };
  return pty;
}

function createRepository(instance: Instance) {
  return {
    current: { ...instance },
    list: vi.fn(async function (this: { current: Instance }) { return [this.current]; }),
    upsert: vi.fn(async function (this: { current: Instance }, value: Instance) { this.current = { ...value }; }),
    remove: vi.fn(async () => undefined),
  };
}
