import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

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
