import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Instance,
  InstanceProcessSource,
  InstanceStats,
  InstanceStatus,
  ProcessStats,
} from '../../shared/domain/instance';
import type { StartCommand } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import type { ChildProcess } from 'node:child_process';
import type { PlatformRegistry } from '../platforms/registry';
import { spawnProcess } from '../utils/process-service';
import { findVenvPython } from '../utils/platform-helper';

export interface PtyProcess {
  pid?: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
  kill(signal?: string): void;
  write?(data: string): void;
  resize?(cols: number, rows: number): void;
}

export type PtyFactory = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; cols: number; rows: number },
) => PtyProcess;

export interface InstanceRuntimeEvents {
  statusChanged: (instanceId: string, status: InstanceStatus) => void;
  ptyData: (instanceId: string, source: InstanceProcessSource, data: string) => void;
}

interface ActiveProcess {
  process: ChildProcess | PtyProcess;
  kind: 'child' | 'pty';
  startedAt: number;
  exited: Promise<void>;
  resolveExited: () => void;
  stopping: boolean;
}

const SOURCES: InstanceProcessSource[] = ['mofox', 'platform'];
const LOG_BUFFER_MAX = 200_000;
const STOP_SIGTERM_DELAY_MS = 4000;
const STOP_SIGKILL_DELAY_MS = 3000;

export class InstanceRuntimeService {
  /** instanceId → source → process */
  private readonly active = new Map<string, Map<InstanceProcessSource, ActiveProcess>>();
  private readonly logBuffers = new Map<string, string>();
  private readonly ptySizes = new Map<string, { cols: number; rows: number }>();

  constructor(
    private readonly repository: {
      list(): Promise<Instance[]>;
      upsert(instance: Instance): Promise<void>;
      remove(instanceId: string): Promise<void>;
    },
    private readonly registry: PlatformRegistry,
    private readonly events: InstanceRuntimeEvents,
    private readonly ptyFactory?: PtyFactory,
    private readonly removePath: (path: string) => Promise<void> = async () => undefined,
    private readonly openPath: (path: string) => Promise<void> = async () => undefined,
    private readonly writeExport: (fileName: string, content: string) => Promise<string> = async () => {
      throw new MofoxError('UNAVAILABLE', 'Log export is not available');
    },
    private readonly stopTimings: { sigterm: number; sigkill: number } = {
      sigterm: STOP_SIGTERM_DELAY_MS,
      sigkill: STOP_SIGKILL_DELAY_MS,
    },
  ) {}

  async start(instanceId: string): Promise<void> {
    const instance = await this.find(instanceId);
    if (this.hasActive(instanceId) || instance.status === 'running' || instance.status === 'starting') return;
    await this.saveStatus(instance, 'starting');
    try {
      const commands = await this.resolveCommands(instance);
      if (commands.size === 0) {
        throw new MofoxError('NOT_FOUND', `实例目录中既没有 MoFox 本体也没有平台启动入口: ${instance.installPath}`);
      }
      for (const [source, command] of commands) {
        this.emitLauncherMessage(instanceId, source, 'info', `正在启动 ${source === 'mofox' ? 'MoFox' : instance.platformId} 进程...`);
        this.spawn(instanceId, source, command);
      }
      await this.saveStatus(instance, 'running');
    } catch (error) {
      this.killAll(instanceId);
      this.emitLauncherMessage(instanceId, 'mofox', 'error', `启动失败: ${error instanceof Error ? error.message : String(error)}`);
      await this.saveStatus(instance, 'error');
      throw error;
    }
  }

  async stop(instanceId: string): Promise<void> {
    const instance = await this.find(instanceId);
    const processes = this.active.get(instanceId);
    if (!processes || processes.size === 0) {
      if (instance.status !== 'stopped') await this.saveStatus(instance, 'stopped');
      return;
    }
    await this.saveStatus(instance, 'stopping');
    await Promise.all(
      [...processes.entries()].map(([source, entry]) => this.stopProcess(instanceId, source, entry)),
    );
    if (!this.hasActive(instanceId)) {
      this.active.delete(instanceId);
      await this.saveStatus(await this.find(instanceId), 'stopped');
    }
  }

  async restart(instanceId: string): Promise<void> {
    await this.stop(instanceId);
    await this.start(instanceId);
  }

  async remove(instanceId: string): Promise<void> {
    const instance = await this.find(instanceId);
    await this.stop(instanceId);
    await this.removePath(instance.installPath);
    await this.repository.remove(instanceId);
    for (const source of SOURCES) {
      this.logBuffers.delete(bufferKey(instanceId, source));
      this.ptySizes.delete(bufferKey(instanceId, source));
    }
  }

  async openFolder(instanceId: string): Promise<void> {
    const instance = await this.find(instanceId);
    await this.openPath(instance.installPath);
  }

  getLogBuffer(instanceId: string, source: InstanceProcessSource): string {
    return this.logBuffers.get(bufferKey(instanceId, source)) ?? '';
  }

  clearLogBuffer(instanceId: string, source: InstanceProcessSource): void {
    this.logBuffers.delete(bufferKey(instanceId, source));
  }

  writePty(instanceId: string, source: InstanceProcessSource, data: string): void {
    const entry = this.active.get(instanceId)?.get(source);
    if (!entry || entry.kind !== 'pty') return;
    (entry.process as PtyProcess).write?.(data);
  }

  resizePty(instanceId: string, source: InstanceProcessSource, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return;
    this.ptySizes.set(bufferKey(instanceId, source), { cols, rows });
    const entry = this.active.get(instanceId)?.get(source);
    if (!entry || entry.kind !== 'pty') return;
    try {
      (entry.process as PtyProcess).resize?.(cols, rows);
    } catch { /* process may have just exited */ }
  }

  getStats(instanceId: string): InstanceStats {
    const stats = {} as InstanceStats;
    for (const source of SOURCES) stats[source] = this.processStats(instanceId, source);
    return stats;
  }

  async exportLogs(instanceId: string, source: InstanceProcessSource): Promise<string> {
    const instance = await this.find(instanceId);
    const content = stripAnsi(this.getLogBuffer(instanceId, source));
    if (!content.trim()) throw new MofoxError('NOT_FOUND', '当前没有可导出的日志');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = instance.name.replace(/[^\p{L}\p{N}._-]+/gu, '_') || instance.id;
    return this.writeExport(`${safeName}_${source}_${timestamp}.log`, content);
  }

  // ── Command resolution ────────────────────────────────────────────

  /** Mirrors the legacy launcher: MoFox = venv python main.py (uv fallback), platform via registry. */
  private async resolveCommands(instance: Instance): Promise<Map<InstanceProcessSource, StartCommand>> {
    const commands = new Map<InstanceProcessSource, StartCommand>();

    const mofoxDir = instance.installPath;
    if (await exists(join(mofoxDir, 'main.py'))) {
      const venvPython = await findVenvPython(mofoxDir);
      const env = {
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1',
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      };
      commands.set(
        'mofox',
        venvPython
          ? { command: venvPython, args: ['main.py'], cwd: mofoxDir, env }
          : { command: 'uv', args: ['run', 'python', 'main.py'], cwd: mofoxDir, env },
      );
    }

    try {
      const platformCommand = await this.registry
        .get(instance.platformId)
        .getStartCommand(instance.installPath, instance.id);
      commands.set('platform', platformCommand);
    } catch (error) {
      // A missing platform is not fatal when MoFox itself can start (MoFox-only instances).
      if (commands.size === 0) throw error;
      this.emitLauncherMessage(
        instance.id,
        'platform',
        'warn',
        `未找到平台启动入口，仅启动 MoFox: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return commands;
  }

  // ── Process lifecycle ─────────────────────────────────────────────

  private spawn(instanceId: string, source: InstanceProcessSource, command: StartCommand): void {
    const env = { ...process.env, ...command.env } as Record<string, string>;
    let resolveExited = () => undefined as void;
    const exited = new Promise<void>((resolve) => { resolveExited = resolve; });
    let entry: ActiveProcess;
    if (this.ptyFactory) {
      const size = this.ptySizes.get(bufferKey(instanceId, source)) ?? { cols: 120, rows: 30 };
      const pty = this.ptyFactory(command.command, command.args, { cwd: command.cwd, env, ...size });
      entry = { process: pty, kind: 'pty', startedAt: Date.now(), exited, resolveExited, stopping: false };
      pty.onData((data) => this.appendLog(instanceId, source, data));
      pty.onExit(({ exitCode }) => {
        entry.resolveExited();
        void this.onProcessExit(instanceId, source, entry, exitCode);
      });
    } else {
      const child = spawnProcess(command.command, command.args, { cwd: command.cwd, env });
      entry = { process: child, kind: 'child', startedAt: Date.now(), exited, resolveExited, stopping: false };
      child.stdout?.on('data', (data: Buffer) => this.appendLog(instanceId, source, data.toString()));
      child.stderr?.on('data', (data: Buffer) => this.appendLog(instanceId, source, data.toString()));
      child.once('close', (code) => {
        entry.resolveExited();
        void this.onProcessExit(instanceId, source, entry, code ?? 0);
      });
      child.once('error', (error: Error) => {
        entry.resolveExited();
        this.emitLauncherMessage(instanceId, source, 'error', `进程启动失败: ${error.message}`);
        void this.onProcessExit(instanceId, source, entry, 1);
      });
    }
    let processes = this.active.get(instanceId);
    if (!processes) {
      processes = new Map();
      this.active.set(instanceId, processes);
    }
    processes.set(source, entry);
  }

  private async stopProcess(instanceId: string, source: InstanceProcessSource, entry: ActiveProcess): Promise<void> {
    if (entry.stopping) {
      await entry.exited;
      return;
    }
    entry.stopping = true;
    this.emitLauncherMessage(instanceId, source, 'info', '正在停止进程...');

    // Graceful shutdown: Ctrl+C → SIGTERM → SIGKILL escalation.
    const pty = entry.kind === 'pty' ? (entry.process as PtyProcess) : undefined;
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
    this.active.get(instanceId)?.delete(source);
    this.emitLauncherMessage(instanceId, source, 'success', '进程已停止');
  }

  private async onProcessExit(
    instanceId: string,
    source: InstanceProcessSource,
    entry: ActiveProcess,
    exitCode: number,
  ): Promise<void> {
    const processes = this.active.get(instanceId);
    if (processes?.get(source) !== entry) return;
    processes.delete(source);
    if (!entry.stopping) {
      if (exitCode === 0) this.emitLauncherMessage(instanceId, source, 'info', '进程已退出');
      else this.emitLauncherMessage(instanceId, source, 'error', `进程异常退出，退出码 ${exitCode}`);
    }
    // Only transition the instance status once every process is gone.
    if (processes && processes.size === 0) {
      this.active.delete(instanceId);
      const instance = await this.find(instanceId);
      if (instance.status === 'stopping' || instance.status === 'stopped') {
        if (instance.status !== 'stopped') await this.saveStatus(instance, 'stopped');
      } else {
        await this.saveStatus(instance, entry.stopping || exitCode === 0 ? 'stopped' : 'error');
      }
    }
  }

  private killAll(instanceId: string): void {
    const processes = this.active.get(instanceId);
    if (!processes) return;
    for (const entry of processes.values()) {
      try {
        if (entry.kind === 'pty') (entry.process as PtyProcess).kill('SIGKILL');
        else (entry.process as ChildProcess).kill('SIGKILL');
      } catch { /* already dead */ }
    }
    this.active.delete(instanceId);
  }

  private hasActive(instanceId: string): boolean {
    return (this.active.get(instanceId)?.size ?? 0) > 0;
  }

  private processStats(instanceId: string, source: InstanceProcessSource): ProcessStats {
    const entry = this.active.get(instanceId)?.get(source);
    if (!entry) return { running: false, uptimeMs: null, pid: null };
    const pid = entry.kind === 'pty'
      ? (entry.process as PtyProcess).pid ?? null
      : (entry.process as ChildProcess).pid ?? null;
    return { running: true, uptimeMs: Date.now() - entry.startedAt, pid };
  }

  private appendLog(instanceId: string, source: InstanceProcessSource, data: string): void {
    const key = bufferKey(instanceId, source);
    const output = `${this.logBuffers.get(key) ?? ''}${data}`;
    this.logBuffers.set(key, output.length > LOG_BUFFER_MAX ? output.slice(-LOG_BUFFER_MAX) : output);
    this.events.ptyData(instanceId, source, data);
  }

  private emitLauncherMessage(
    instanceId: string,
    source: InstanceProcessSource,
    level: 'info' | 'success' | 'warn' | 'error',
    message: string,
  ): void {
    const colors = { info: '\x1b[36m', success: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' } as const;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.appendLog(instanceId, source, `\x1b[90m${time}\x1b[0m ${colors[level]}[Launcher]\x1b[0m ${message}\r\n`);
  }

  private async find(instanceId: string): Promise<Instance> {
    if (!instanceId.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
    const instance = (await this.repository.list()).find((candidate) => candidate.id === instanceId);
    if (!instance) throw new MofoxError('NOT_FOUND', `未知实例: ${instanceId}`);
    return instance;
  }

  private async saveStatus(instance: Instance, status: InstanceStatus): Promise<void> {
    const updated = { ...instance, status, ...(status === 'running' ? { lastStartedAt: Date.now() } : {}) };
    await this.repository.upsert(updated);
    this.events.statusChanged(instance.id, status);
  }
}

function bufferKey(instanceId: string, source: InstanceProcessSource): string {
  return `${instanceId}:${source}`;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  // CSI sequence first so the single-char alternative cannot eat the leading '['.
  return value.replace(new RegExp(`${escape}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`, 'g'), '');
}
