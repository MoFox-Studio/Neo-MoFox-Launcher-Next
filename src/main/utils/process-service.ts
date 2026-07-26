import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

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