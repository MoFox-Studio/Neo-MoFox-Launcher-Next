import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import {
  InstanceTerminalService,
  type TerminalProcessHost,
} from '../../../src/main/services/instance-terminal-service';
import type { ProcessIdentity } from '../../../src/main/utils/process-helper';

/** 覆盖目录解析、虚拟环境注入、会话互斥重启、退出事件过滤与进程回收。 */
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix = '.test-terminal-service-'): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }).catch(() => undefined)),
  );
});

/** 构造带 venv 解释器的虚拟环境目录，触发 venv 激活分支。 */
async function createVenvDirectory(root: string, name = '.venv'): Promise<string> {
  const directory = join(root, name);
  await mkdir(join(directory, 'bin'), { recursive: true });
  await writeFile(join(directory, 'bin', 'python3'), '#!/bin/sh\n');
  return directory;
}

interface SpawnRecord {
  key: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  onData: (data: string) => void;
  onExit: (event: { exitCode: number; signal?: number }, identity: ProcessIdentity) => void;
  onError: (error: Error, identity: ProcessIdentity) => void;
}

/** 记录 spawn 参数的进程宿主替身；has 跟随已 spawn 的会话数量，模拟真实进程表。 */
function createHelper() {
  const spawns: SpawnRecord[] = [];
  const identities: ProcessIdentity[] = [];
  const helper = {
    spawns,
    identities,
    spawn: vi.fn((key: string, options: Omit<SpawnRecord, 'key'>) => {
      const identity = Symbol(key) as ProcessIdentity;
      identities.push(identity);
      spawns.push({ key, ...options });
      return identity;
    }),
    killAll: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    has: vi.fn(() => spawns.length > 0),
  };
  return helper as typeof helper & TerminalProcessHost;
}

function createEvents() {
  return {
    data: vi.fn(),
    exited: vi.fn(),
  };
}

async function createInstance(overrides: Partial<Instance> = {}): Promise<Instance> {
  const root = await createTemporaryDirectory();
  const mofoxDir = join(root, 'mofox');
  await mkdir(mofoxDir, { recursive: true });
  return {
    id: 'one',
    name: 'One',
    mofoxInstallDir: mofoxDir,
    platform: { id: null, installDir: null, version: null },
    venvDir: '',
    status: 'stopped',
    createdAt: 0,
    lastStartedAt: null,
    autoStart: false,
    extra: { isLike: false },
    ...overrides,
  };
}

const FAKE_SHELLS = [
  { id: 'bash', label: 'Bash', command: '/bin/fake-shell', args: [], isDefault: true },
  { id: 'zsh', label: 'Zsh', command: '/bin/fake-zsh', args: ['-l'], isDefault: false },
];

function createService(instance: Instance) {
  const helper = createHelper();
  const events = createEvents();
  const repository = { list: vi.fn(async () => [instance]) };
  const service = new InstanceTerminalService(repository, helper, events, async () => FAKE_SHELLS);
  return { service, helper, events, repository };
}

describe('InstanceTerminalService', () => {
  it('opens a session in the instance directory and returns the resolved cwd', async () => {
    const instance = await createInstance();
    const { service, helper } = createService(instance);

    const result = await service.open('one', 'mofox');

    expect(result).toEqual({ cwd: instance.mofoxInstallDir });
    expect(helper.spawns).toHaveLength(1);
    const spawn = helper.spawns[0];
    expect(spawn.key).toBe('terminal:one');
    expect(spawn.command).toBe('/bin/fake-shell');
    expect(spawn.cwd).toBe(instance.mofoxInstallDir);
    expect(spawn.env.TERM).toBe('xterm-256color');
  });

  it('activates the venv for every working directory when an interpreter exists', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenvDirectory(root);
    const instance = await createInstance({ venvDir });
    const { service, helper } = createService(instance);

    await service.open('one', 'mofox');

    const { env } = helper.spawns[0];
    expect(env.VIRTUAL_ENV).toBe(venvDir);
    const binDir = join(venvDir, 'bin');
    expect(env.PATH?.startsWith(binDir)).toBe(true);
    expect(env.PATH).toContain(process.env.PATH ?? '');
  });

  it('skips venv activation when no interpreter exists', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = join(root, 'empty-venv');
    await mkdir(venvDir, { recursive: true });
    const instance = await createInstance({ venvDir });
    const { service, helper } = createService(instance);

    await service.open('one', 'mofox');

    const { env } = helper.spawns[0];
    expect(env.VIRTUAL_ENV).toBeUndefined();
    expect(env.PATH).toBeUndefined();
  });

  it('opens in the venv directory and the platform directory by kind', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = join(root, '.venv');
    await mkdir(venvDir, { recursive: true });
    const platformDir = join(root, 'platform');
    await mkdir(platformDir, { recursive: true });
    const instance = await createInstance({
      venvDir,
      platform: { id: 'napcat', installDir: platformDir, version: '1.0.0' },
    });
    const { service, helper } = createService(instance);

    const venvResult = await service.open('one', 'venv');
    const platformResult = await service.open('one', 'platform');

    expect(venvResult).toEqual({ cwd: venvDir });
    expect(platformResult).toEqual({ cwd: platformDir });
    expect(helper.spawns.map((spawn) => spawn.cwd)).toEqual([venvDir, platformDir]);
  });

  it('rejects a missing venv directory without spawning', async () => {
    const instance = await createInstance({ venvDir: join(process.cwd(), '.no-such-venv') });
    const { service, helper } = createService(instance);

    await expect(service.open('one', 'venv')).rejects.toThrow('虚拟环境目录不存在');
    expect(helper.spawns).toHaveLength(0);
  });

  it('rejects an uninstalled platform without spawning', async () => {
    const instance = await createInstance();
    const { service, helper } = createService(instance);

    await expect(service.open('one', 'platform')).rejects.toThrow('实例未安装平台适配器');
    expect(helper.spawns).toHaveLength(0);
  });

  it('rejects an unknown instance without spawning', async () => {
    const instance = await createInstance();
    const { service, helper } = createService(instance);

    await expect(service.open('missing', 'mofox')).rejects.toThrow('未知实例: missing');
    expect(helper.spawns).toHaveLength(0);
  });

  it('restarts the session when switching directories: kills the old session first', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = join(root, '.venv');
    await mkdir(venvDir, { recursive: true });
    const instance = await createInstance({ venvDir });
    const { service, helper } = createService(instance);
    await service.open('one', 'mofox');

    const result = await service.open('one', 'venv', { size: { cols: 100, rows: 24 } });

    expect(result).toEqual({ cwd: venvDir });
    expect(helper.killAll).toHaveBeenCalledWith('terminal:one');
    expect(helper.resize).toHaveBeenCalledWith('terminal:one', 100, 24);
    expect(helper.spawns).toHaveLength(2);
    expect(helper.spawns[1].cwd).toBe(venvDir);
  });

  it('spawns the default shell when no shell id is given', async () => {
    const instance = await createInstance();
    const { service, helper } = createService(instance);

    await service.open('one', 'mofox');

    const spawn = helper.spawns[0];
    expect(spawn.command).toBe('/bin/fake-shell');
    expect(spawn.args).toEqual([]);
  });

  it('spawns the requested shell by id', async () => {
    const instance = await createInstance();
    const { service, helper } = createService(instance);

    await service.open('one', 'mofox', { shellId: 'zsh' });

    const spawn = helper.spawns[0];
    expect(spawn.command).toBe('/bin/fake-zsh');
    expect(spawn.args).toEqual(['-l']);
  });

  it('rejects an unknown shell id without spawning', async () => {
    const instance = await createInstance();
    const { service, helper } = createService(instance);

    await expect(service.open('one', 'mofox', { shellId: 'fish' })).rejects.toThrow(
      '未知终端程序: fish',
    );
    expect(helper.spawns).toHaveLength(0);
  });

  it('lists the available shells for the panel dropdown', async () => {
    const instance = await createInstance();
    const { service } = createService(instance);

    await expect(service.listShells()).resolves.toEqual(FAKE_SHELLS);
  });

  it('emits exited only for the current session identity', async () => {
    const instance = await createInstance();
    const { service, helper, events } = createService(instance);
    await service.open('one', 'mofox');
    const spawn = helper.spawns[0];
    const staleIdentity = Symbol('stale') as ProcessIdentity;

    spawn.onExit({ exitCode: 0 }, staleIdentity);
    expect(events.exited).not.toHaveBeenCalled();

    spawn.onExit({ exitCode: 3 }, helper.identities[0]);
    expect(events.exited).toHaveBeenCalledWith('one', 3);

    // 关闭后旧身份的延迟退出不再触发事件。
    await service.close('one');
    spawn.onExit({ exitCode: 0 }, helper.identities[0]);
    expect(events.exited).toHaveBeenCalledTimes(1);
  });

  it('streams output through the data event and delegates write and resize', async () => {
    const instance = await createInstance();
    const { service, helper, events } = createService(instance);
    await service.open('one', 'mofox');

    helper.spawns[0].onData('hello\r\n');
    service.write('one', 'ls\r');
    service.resize('one', 88, 20);

    expect(events.data).toHaveBeenCalledWith('one', 'hello\r\n');
    expect(helper.write).toHaveBeenCalledWith('terminal:one', 'ls\r');
    expect(helper.resize).toHaveBeenCalledWith('terminal:one', 88, 20);
  });

  it('close kills the session process tree', async () => {
    const instance = await createInstance();
    const { service, helper } = createService(instance);
    await service.open('one', 'mofox');

    await service.close('one');

    expect(helper.killAll).toHaveBeenCalledWith('terminal:one');
  });
});
