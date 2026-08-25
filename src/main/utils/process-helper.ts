import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { ProcessStats } from '../../shared/domain/instance';

// 主进程对外部命令的最小封装，统一隐藏窗口、采集输出和处理进程生命周期。
export interface ExecOptions extends SpawnOptions {
  timeoutMs?: number;
  /** 可选的 stdin 字符串；提供后通过子进程 stdin 写入并立即关闭。 */
  input?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: NodeJS.Signals;
  timedOut: boolean;
}

/**
 * 启动子进程，默认隐藏 Windows 控制台窗口。
 *
 * @param command - 待执行的命令名。
 * @param args - 命令参数列表。
 * @param options - 透传给 `spawn` 的选项。
 * @returns ChildProcess 实例。
 */
export function spawnProcess(command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  return spawn(command, [...args], {
    windowsHide: true,
    ...options,
  });
}

/**
 * 执行一次性命令并捕获其完整输出。
 *
 * 统一处理 spawn error、close 与超时三种终态，超时先 SIGTERM 再 SIGKILL 强制终止。
 *
 * @param command - 待执行的命令名。
 * @param args - 命令参数列表。
 * @param options - 执行选项，`timeoutMs` 默认 30 秒。
 * @returns 包含 stdout/stderr/exitCode/signal/timedOut 的执行结果。
 */
export function runOneShot(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const { timeoutMs = 30_000, input, ...spawnOptions } = options;
    const stdio: SpawnOptions['stdio'] =
      input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child: ChildProcess;

    /**
     * 以首个进程终态结算执行结果，并清理超时定时器。
     *
     * @param exitCode - 子进程退出码；未能启动时为 `null`。
     * @param signal - 终止子进程的可选信号。
     */
    const finish = (exitCode: number | null, signal?: NodeJS.Signals) => {
      // spawn error、close 和超时终止可能交错发生，只允许第一个终态结算结果。
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, ...(signal ? { signal } : {}), timedOut });
    };

    try {
      child = spawnProcess(command, args, { ...spawnOptions, stdio });
    } catch (error) {
      resolve({ stdout, stderr: toError(error).message, exitCode: null, timedOut: false });
      return;
    }

    if (input !== undefined && child.stdin) {
      // sudo -S 等命令通过 stdin 读取密码；写入后立即关闭以触发子进程退出。
      child.stdin.write(input);
      child.stdin.end();
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      stderr += `${stderr ? '\n' : ''}${error.message}`;
      finish(null);
    });
    child.once('close', (code, signal) => finish(code, signal ?? undefined));

    const timer = setTimeout(() => {
      timedOut = true;
      // 先请求正常终止，再在宽限期后强制杀死，覆盖不响应 SIGTERM 的子进程。
      child.kill('SIGTERM');
      const forceTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      forceTimer.unref();
    }, timeoutMs);
    timer.unref();
  });
}

/**
 * 将任意值转换为 Error 实例，便于诊断报告统一处理。
 *
 * @param value - 待转换的值。
 * @returns Error 实例。
 */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** 与实例解耦的进程句柄抽象：PTY 与普通子进程共用同一生命周期接口。 */
export interface ProcessHandle {
  pid?: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  kill(signal?: string): void;
  write?(data: string): void;
  resize?(cols: number, rows: number): void;
}

/** 构造 PTY 进程的工厂，与 node-pty 的具体实现解耦，便于测试注入替身。 */
export type ProcessFactory = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; cols: number; rows: number },
) => ProcessHandle;

/** 由调用方提供的进程事件订阅，用于把输出、退出和启动失败回流到业务层。 */
export interface ProcessSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  onData: (data: string) => void;
  onExit: (event: { exitCode: number; signal?: number }) => void;
  onError: (error: Error) => void;
}

interface ManagedProcess {
  process: ChildProcess | ProcessHandle;
  kind: 'child' | 'pty';
  startedAt: number;
  exited: Promise<void>;
  resolveExited: () => void;
  stopping: boolean;
}

const DEFAULT_SIZE = { cols: 120, rows: 30 };
const DEFAULT_SIGTERM_DELAY_MS = 4000;
const DEFAULT_SIGKILL_DELAY_MS = 3000;

/**
 * 通用、与实例解耦的进程管理核心。
 *
 * 以字符串键（如 `${instanceId}:${source}`）维护一组 PTY 或普通子进程，
 * 统一提供 spawn / stop / killAll / write / resize / getStats / has / remove，
 * 并实现 Ctrl+C → SIGTERM → SIGKILL 三级升级停止策略。
 */
export class ProcessHelper {
  private readonly active = new Map<string, ManagedProcess>();
  private readonly sizes = new Map<string, { cols: number; rows: number }>();

  constructor(
    private readonly ptyFactory?: ProcessFactory,
    private readonly stopTimings: { sigterm: number; sigkill: number } = {
      sigterm: DEFAULT_SIGTERM_DELAY_MS,
      sigkill: DEFAULT_SIGKILL_DELAY_MS,
    },
  ) {}

  /**
   * 启动一个进程并注册到指定键下。
   *
   * 提供 PTY 工厂时使用 PTY，否则退化为普通子进程（复用 `spawnProcess`）；
   * 两种实现都接入 onData / onExit / onError 回调。
   *
   * @param key - 进程的稳定标识（如 `${instanceId}:${source}`）。
   * @param options - 启动命令与事件订阅。
   */
  spawn(key: string, options: ProcessSpawnOptions): void {
    const env = { ...process.env, ...options.env } as Record<string, string>;
    let resolveExited = () => undefined as void;
    const exited = new Promise<void>((resolve) => { resolveExited = resolve; });
    let entry: ManagedProcess;
    if (this.ptyFactory) {
      const size = this.sizes.get(key) ?? DEFAULT_SIZE;
      const pty = this.ptyFactory(options.command, options.args, { cwd: options.cwd, env, ...size });
      entry = { process: pty, kind: 'pty', startedAt: Date.now(), exited, resolveExited, stopping: false };
      pty.onData(options.onData);
      pty.onExit(options.onExit);
    } else {
      const child = spawnProcess(options.command, options.args, { cwd: options.cwd, env });
      entry = { process: child, kind: 'child', startedAt: Date.now(), exited, resolveExited, stopping: false };
      child.stdout?.on('data', (data: Buffer) => options.onData(data.toString()));
      child.stderr?.on('data', (data: Buffer) => options.onData(data.toString()));
      child.once('close', (code) => options.onExit({ exitCode: code ?? 0 }));
      child.once('error', (error) => options.onError(error));
    }
    this.active.set(key, entry);
  }

  /**
   * 优雅停止指定键的进程。
   *
   * 采用 Ctrl+C → SIGTERM → SIGKILL 三级升级策略，等待退出后从注册表移除。
   *
   * @param key - 待停止的进程键。
   */
  async stop(key: string): Promise<void> {
    const entry = this.active.get(key);
    if (!entry) return;
    if (entry.stopping) {
      await entry.exited;
      return;
    }
    entry.stopping = true;

    const pty = entry.kind === 'pty' ? (entry.process as ProcessHandle) : undefined;
    const child = entry.kind === 'child' ? (entry.process as ChildProcess) : undefined;
    if (pty?.write) pty.write('\x03');
    else if (pty) pty.kill('SIGTERM');
    else child?.kill('SIGTERM');

    const timers: NodeJS.Timeout[] = [];
    if (pty?.write) {
      timers.push(setTimeout(() => { try { pty.kill('SIGTERM'); } catch { /* already dead */ } }, this.stopTimings.sigterm));
    }
    timers.push(
      setTimeout(() => {
        try {
          if (pty) pty.kill('SIGKILL');
          else child?.kill('SIGKILL');
        } catch { /* already dead */ }
      }, this.stopTimings.sigterm + this.stopTimings.sigkill),
    );

    await Promise.race([
      entry.exited,
      new Promise<void>((resolve) => timers.push(setTimeout(resolve, this.stopTimings.sigterm + this.stopTimings.sigkill + 1000))),
    ]);
    for (const timer of timers) clearTimeout(timer);
    this.active.delete(key);
  }

  /**
   * 强制终止进程，可指定单个键或全部。
   *
   * @param key - 可选的进程键；省略时终止所有已注册进程。
   */
  killAll(key?: string): void {
    const targets = key ? [key] : [...this.active.keys()];
    for (const target of targets) {
      const entry = this.active.get(target);
      if (!entry) continue;
      try {
        if (entry.kind === 'pty') (entry.process as ProcessHandle).kill('SIGKILL');
        else (entry.process as ChildProcess).kill('SIGKILL');
      } catch { /* already dead */ }
      this.active.delete(target);
    }
  }

  /**
   * 向指定键的 PTY 写入数据；非活动或非 PTY 进程的写入被静默丢弃。
   *
   * @param key - 进程键。
   * @param data - 待写入的数据。
   */
  write(key: string, data: string): void {
    const entry = this.active.get(key);
    if (!entry || entry.kind !== 'pty') return;
    (entry.process as ProcessHandle).write?.(data);
  }

  /**
   * 调整指定键 PTY 的列高；非正整数参数或非活动 PTY 时忽略。
   *
   * @param key - 进程键。
   * @param cols - 列数。
   * @param rows - 行数。
   */
  resize(key: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return;
    this.sizes.set(key, { cols, rows });
    const entry = this.active.get(key);
    if (!entry || entry.kind !== 'pty') return;
    try {
      (entry.process as ProcessHandle).resize?.(cols, rows);
    } catch { /* process may have just exited */ }
  }

  /**
   * 获取指定键进程的运行统计。
   *
   * @param key - 进程键。
   * @returns 进程统计；不存在时返回未运行状态。
   */
  getStats(key: string): ProcessStats {
    const entry = this.active.get(key);
    if (!entry) return { running: false, uptimeMs: null, pid: null };
    const pid = entry.kind === 'pty'
      ? (entry.process as ProcessHandle).pid ?? null
      : (entry.process as ChildProcess).pid ?? null;
    return { running: true, uptimeMs: Date.now() - entry.startedAt, pid };
  }

  /**
   * 判断指定键是否有活动进程。
   *
   * @param key - 进程键。
   * @returns 存在且未退出返回 `true`。
   */
  has(key: string): boolean {
    return this.active.has(key);
  }

  /**
   * 移除指定键的进程并清理其尺寸记录。
   *
   * @param key - 进程键。
   */
  remove(key: string): void {
    this.active.delete(key);
    this.sizes.delete(key);
  }
}
