import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

// 主进程对外部命令的最小封装，统一隐藏窗口、采集输出和处理进程生命周期。
export interface ExecOptions extends SpawnOptions {
  timeoutMs?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: NodeJS.Signals;
  timedOut: boolean;
}

export function spawnProcess(command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  return spawn(command, [...args], {
    windowsHide: true,
    ...options,
  });
}

export function runOneShot(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const { timeoutMs = 30_000, ...spawnOptions } = options;
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
      child = spawnProcess(command, args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ stdout, stderr: toError(error).message, exitCode: null, timedOut: false });
      return;
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

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
