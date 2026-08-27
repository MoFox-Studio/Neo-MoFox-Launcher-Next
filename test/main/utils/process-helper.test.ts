import { describe, expect, it, vi } from 'vitest';
import {
  runOneShot,
  ProcessHelper,
  type ProcessHandle,
} from '../../../src/main/utils/process-helper';

// 树杀能力通过 tree-kill 实现，测试中替换为成功回调，避免对真实系统进程发信号。
const { treeKillMock } = vi.hoisted(() => ({ treeKillMock: vi.fn() }));
vi.mock('tree-kill', () => ({
  default: (pid: number, signal: string, callback: (error?: Error) => void) => {
    treeKillMock(pid, signal, callback);
    callback();
  },
}));

describe('runOneShot', () => {
  // 分别验证子进程输出边界、启动失败结算和超时后的终止路径。
  it('captures stdout, stderr and the exit code separately', async () => {
    const result = await runOneShot(process.execPath, [
      '-e',
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    ]);

    expect(result).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 3, timedOut: false });
  });

  it('reports spawn failures without hanging', async () => {
    const result = await runOneShot('definitely-not-a-real-command-mofox', []);

    expect(result.exitCode).toBeNull();
    expect(result.stderr).not.toBe('');
  });

  it('times out and terminates long-running commands', async () => {
    const result = await runOneShot(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  });
});

/** 验证 ExecOptions.input 字段：写入后子进程 stdin 能正确读取到密码等输入。 */
describe('runOneShot with stdin input', () => {
  it('writes the input string to child stdin', async () => {
    const result = await runOneShot(
      process.execPath,
      [
        '-e',
        "process.stdin.on('data', d => process.stdout.write(d)); process.stdin.on('end', () => process.exit(0))",
      ],
      { input: 'hello-stdin\n', timeoutMs: 5_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello-stdin\n');
  });

  it('does not write to stdin when input is omitted', async () => {
    const result = await runOneShot(process.execPath, ['-e', 'process.exit(0)']);
    expect(result.exitCode).toBe(0);
  });
});

/** 覆盖与实例解耦的进程管理核心：PTY 生命周期、三级升级停止与统计收敛。 */
const FAST_TIMINGS = { sigterm: 10, sigkill: 10, batchAnswer: 5 };

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

function makeOptions(overrides: Partial<Parameters<ProcessHelper['spawn']>[1]> = {}) {
  return {
    command: 'bot',
    args: [] as string[],
    cwd: 'D:\\Bot',
    env: {},
    onData: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('ProcessHelper', () => {
  it('spawns a PTY, forwards data and reports stats', () => {
    const pty = createPty();
    const helper = new ProcessHelper(
      vi.fn(() => pty),
      FAST_TIMINGS,
    );
    const options = makeOptions();
    helper.spawn('key', options);

    expect(helper.has('key')).toBe(true);
    pty.emitData('hello');
    expect(options.onData).toHaveBeenCalledWith('hello');
    const stats = helper.getStats('key');
    expect(stats.running).toBe(true);
    expect(stats.pid).toBe(1234);
  });

  it('stops a PTY via Ctrl+C then process-tree escalation', async () => {
    const pty = createPty();
    const helper = new ProcessHelper(
      vi.fn(() => pty),
      FAST_TIMINGS,
    );
    const options = makeOptions();
    helper.spawn('key', options);
    treeKillMock.mockClear();

    await helper.stop('key');

    expect(pty.write).toHaveBeenCalledWith('\x03');
    // 批处理收到 Ctrl+C 后会询问 “Terminate batch job (Y/N)?”，自动应答 Y 以完成优雅退出。
    expect(pty.write).toHaveBeenCalledWith('Y\r');
    // 升级阶段按进程树终止：先 SIGTERM 再 SIGKILL，均以进程 pid 为目标而非仅直接句柄。
    expect(treeKillMock).toHaveBeenCalledWith(1234, 'SIGTERM', expect.any(Function));
    expect(treeKillMock).toHaveBeenCalledWith(1234, 'SIGKILL', expect.any(Function));
    expect(options.onExit).toHaveBeenCalled();
    expect(helper.has('key')).toBe(false);
    expect(helper.getStats('key').running).toBe(false);
  });

  it('falls back to the direct handle when the process has no pid', async () => {
    const pty = createPty();
    pty.pid = undefined;
    const helper = new ProcessHelper(
      vi.fn(() => pty),
      FAST_TIMINGS,
    );
    const options = makeOptions();
    helper.spawn('key', options);

    await helper.stop('key');

    expect(treeKillMock).not.toHaveBeenCalled();
    expect(pty.kill).toHaveBeenCalled();
    expect(options.onExit).toHaveBeenCalled();
    expect(helper.has('key')).toBe(false);
  });

  it('writes and resizes only an active PTY', () => {
    const pty = createPty();
    const helper = new ProcessHelper(
      vi.fn(() => pty),
      FAST_TIMINGS,
    );
    helper.resize('key', 100, 40);
    helper.spawn('key', makeOptions());

    expect(helper.getStats('key').running).toBe(true);
    helper.write('key', 'help\r');
    helper.resize('key', 90, 30);
    expect(pty.write).toHaveBeenCalledWith('help\r');
    expect(pty.resize).toHaveBeenCalledWith(90, 30);
  });

  it('removes a key and clears its stats', () => {
    const pty = createPty();
    const helper = new ProcessHelper(
      vi.fn(() => pty),
      FAST_TIMINGS,
    );
    helper.spawn('key', makeOptions());
    expect(helper.has('key')).toBe(true);

    helper.remove('key');

    expect(helper.has('key')).toBe(false);
    expect(helper.getStats('key')).toEqual({ running: false, uptimeMs: null, pid: null });
  });

  it('killAll terminates every tracked process tree', () => {
    const ptyA = createPty();
    const ptyB = createPty();
    const factory = vi.fn().mockReturnValueOnce(ptyA).mockReturnValueOnce(ptyB);
    const helper = new ProcessHelper(factory, FAST_TIMINGS);
    helper.spawn('a', makeOptions());
    helper.spawn('b', makeOptions());
    treeKillMock.mockClear();

    helper.killAll();

    expect(treeKillMock).toHaveBeenCalledWith(1234, 'SIGKILL', expect.any(Function));
    expect(treeKillMock).toHaveBeenCalledTimes(2);
    expect(helper.has('a')).toBe(false);
    expect(helper.has('b')).toBe(false);
  });
});
