import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Instance,
  InstanceProcessSource,
  InstanceStats,
  InstanceStatus,
} from '../../shared/domain/instance';
import type { StartCommand } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import type { PlatformRegistry } from '../platforms/registry';
import { ProcessHelper } from '../utils/process-helper';
import { findVenvPython } from '../utils/platform-helper';
import type { UpdateInstancePatch } from '../../shared/domain/instance';

/**
 * 协调实例进程的启动、停止、日志和状态持久化；运行态只保留在内存，状态变化通过 events 同步给渲染进程。
 * 进程启动、停止和统计委托给与实例解耦的 ProcessHelper，本服务只保留平台运行编排与状态收敛。
 */
export interface InstanceRuntimeEvents {
  statusChanged: (instanceId: string, status: InstanceStatus) => void;
  ptyData: (instanceId: string, source: InstanceProcessSource, data: string) => void;
}

export type WriteExport = (fileName: string, content: string) => Promise<string>;

const SOURCES: InstanceProcessSource[] = ['mofox', 'platform'];
const LOG_BUFFER_MAX = 200_000;

export class InstanceRuntimeService {
  /** 实例到仍在运行进程源的索引，全部退出后与仓库状态一并收敛。 */
  private readonly running = new Map<string, Set<InstanceProcessSource>>();
  /** 正在被优雅停止的进程键，用于区分正常退出与人为停止。 */
  private readonly stoppingKeys = new Set<string>();
  private readonly logBuffers = new Map<string, string>();

  constructor(
    private readonly repository: {
      list(): Promise<Instance[]>;
      update(instanceId: string, patch: UpdateInstancePatch): Promise<Instance>;
    },
    private readonly registry: PlatformRegistry,
    private readonly events: InstanceRuntimeEvents,
    private readonly helper: ProcessHelper,
    private readonly writeExport: WriteExport = async () => {
      throw new MofoxError('UNAVAILABLE', 'Log export is not available');
    },
  ) {}

  /**
   * 启动指定实例的全部进程源（MoFox 与平台）。
   *
   * 已在运行的来源会被跳过，因此可同时承担"全部启动"与"补齐未运行进程"两种语义；
   * 全部已运行时直接返回保持幂等。启动失败时回收本次新拉起的进程并持久化 error 状态。
   *
   * @param instanceId - 待启动的实例 ID。
   * @throws {MofoxError} 实例不存在、无可用启动入口或进程启动失败时抛出。
   */
  async start(instanceId: string): Promise<void> {
    const instance = await this.find(instanceId);
    if (instance.status === 'starting') return;
    const started: InstanceProcessSource[] = [];
    await this.saveStatus(instance, 'starting');
    try {
      const commands = await this.resolveCommands(instance);
      if (commands.size === 0) {
        throw new MofoxError(
          'NOT_FOUND',
          `实例未配置 MoFox 本体目录或平台路径: mofoxInstallDir=${instance.mofoxInstallDir}`,
        );
      }
      for (const [source, command] of commands) {
        if (this.helper.has(this.key(instanceId, source))) continue;
        this.emitLauncherMessage(
          instanceId,
          source,
          'info',
          `正在启动 ${source === 'mofox' ? 'MoFox' : '平台'} 进程...`,
        );
        this.spawn(instanceId, source, command);
        started.push(source);
      }
      await this.saveStatus(await this.find(instanceId), 'running');
    } catch (error) {
      // 部分启动失败时仅回收本次新拉起的进程，保留原先已在运行的来源。
      for (const source of started) this.helper.killAll(this.key(instanceId, source));
      this.emitLauncherMessage(
        instanceId,
        'mofox',
        'error',
        `启动失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.saveStatus(await this.find(instanceId), 'error');
      throw error;
    }
  }

  /**
   * 仅启动指定实例的单个进程源。
   *
   * 已在该源下运行的进程直接返回；启动失败时回收该进程并持久化当前聚合状态。
   *
   * @param instanceId - 实例 ID。
   * @param source - 待启动的进程源（`mofox` 或 `platform`）。
   * @throws {MofoxError} 实例不存在、无该源可用启动入口或进程启动失败时抛出。
   */
  async startSource(instanceId: string, source: InstanceProcessSource): Promise<void> {
    const instance = await this.find(instanceId);
    if (this.helper.has(this.key(instanceId, source))) return;
    const command = await this.resolveCommand(instance, source);
    if (!command) {
      throw new MofoxError(
        'NOT_FOUND',
        source === 'mofox'
          ? `实例未配置 MoFox 本体目录: mofoxInstallDir=${instance.mofoxInstallDir}`
          : '实例未配置平台路径',
      );
    }
    if (instance.status !== 'running' && instance.status !== 'starting') {
      await this.saveStatus(instance, 'starting');
    }
    try {
      this.emitLauncherMessage(
        instanceId,
        source,
        'info',
        `正在启动 ${source === 'mofox' ? 'MoFox' : '平台'} 进程...`,
      );
      this.spawn(instanceId, source, command);
    } catch (error) {
      this.helper.killAll(this.key(instanceId, source));
      this.stoppingKeys.delete(this.key(instanceId, source));
      this.emitLauncherMessage(
        instanceId,
        source,
        'error',
        `启动失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.saveStatus(
        await this.find(instanceId),
        this.hasActive(instanceId) ? 'running' : 'stopped',
      );
      throw error;
    }
    await this.saveStatus(await this.find(instanceId), 'running');
  }

  /**
   * 停止指定实例的全部进程源。
   *
   * 通过 ProcessHelper 的 Ctrl+C → SIGTERM → SIGKILL 三级升级策略关闭进程；
   * 无活动进程时仅同步持久化状态为 stopped。
   *
   * @param instanceId - 待停止的实例 ID。
   */
  async stop(instanceId: string): Promise<void> {
    const instance = await this.find(instanceId);
    const sources = this.running.get(instanceId);
    if (!sources || sources.size === 0) {
      if (instance.status !== 'stopped') await this.saveStatus(instance, 'stopped');
      return;
    }
    await this.saveStatus(instance, 'stopping');
    for (const source of [...sources]) {
      const key = this.key(instanceId, source);
      this.stoppingKeys.add(key);
      this.emitLauncherMessage(instanceId, source, 'info', '正在停止进程...');
      await this.helper.stop(key);
      this.emitLauncherMessage(instanceId, source, 'success', '进程已停止');
    }
    if (!this.hasActive(instanceId)) {
      this.running.delete(instanceId);
      await this.saveStatus(await this.find(instanceId), 'stopped');
    }
  }

  /**
   * 仅停止指定实例的单个进程源。
   *
   * 该源无活动进程时仅同步状态；其余进程源保持运行则实例仍为 running。
   *
   * @param instanceId - 实例 ID。
   * @param source - 待停止的进程源。
   */
  async stopSource(instanceId: string, source: InstanceProcessSource): Promise<void> {
    const instance = await this.find(instanceId);
    const key = this.key(instanceId, source);
    if (!this.helper.has(key)) {
      if (!this.hasActive(instanceId) && instance.status !== 'stopped')
        await this.saveStatus(instance, 'stopped');
      return;
    }
    await this.saveStatus(instance, 'stopping');
    this.stoppingKeys.add(key);
    this.emitLauncherMessage(instanceId, source, 'info', '正在停止进程...');
    await this.helper.stop(key);
    this.emitLauncherMessage(instanceId, source, 'success', '进程已停止');
    const current = await this.find(instanceId);
    await this.saveStatus(current, this.hasActive(instanceId) ? 'running' : 'stopped');
  }

  /**
   * 重启实例：先停止再启动。
   *
   * @param instanceId - 待重启的实例 ID。
   */
  async restart(instanceId: string): Promise<void> {
    await this.stop(instanceId);
    await this.start(instanceId);
  }

  /**
   * 仅重启指定实例的单个进程源。
   *
   * @param instanceId - 实例 ID。
   * @param source - 待重启的进程源。
   */
  async restartSource(instanceId: string, source: InstanceProcessSource): Promise<void> {
    await this.stopSource(instanceId, source);
    await this.startSource(instanceId, source);
  }

  /**
   * 获取指定进程源的内存日志缓冲。
   *
   * @param instanceId - 实例 ID。
   * @param source - 进程源（`mofox` 或 `platform`）。
   * @returns 当前缓冲的日志字符串；不存在时为空串。
   */
  getLogBuffer(instanceId: string, source: InstanceProcessSource): string {
    return this.logBuffers.get(this.key(instanceId, source)) ?? '';
  }

  /**
   * 清空指定进程源的内存日志缓冲。
   *
   * @param instanceId - 实例 ID。
   * @param source - 进程源。
   */
  clearLogBuffer(instanceId: string, source: InstanceProcessSource): void {
    this.logBuffers.delete(this.key(instanceId, source));
  }

  /**
   * 清空实例全部进程源的内存日志缓冲，供管理服务在删除实例后回收。
   *
   * @param instanceId - 实例 ID。
   */
  clearLogs(instanceId: string): void {
    for (const source of SOURCES) this.logBuffers.delete(this.key(instanceId, source));
  }

  /**
   * 向指定进程源的 PTY 写入数据。
   *
   * 非活动或非 PTY 进程的写入将被静默丢弃。
   *
   * @param instanceId - 实例 ID。
   * @param source - 进程源。
   * @param data - 待写入 PTY 的字符串数据。
   */
  writePty(instanceId: string, source: InstanceProcessSource, data: string): void {
    this.helper.write(this.key(instanceId, source), data);
  }

  /**
   * 调整指定进程源 PTY 的列高。
   *
   * 非正整数参数或非活动 PTY 时的调用将被静默忽略。
   *
   * @param instanceId - 实例 ID。
   * @param source - 进程源。
   * @param cols - 新的列数。
   * @param rows - 新的行数。
   */
  resizePty(instanceId: string, source: InstanceProcessSource, cols: number, rows: number): void {
    this.helper.resize(this.key(instanceId, source), cols, rows);
  }

  /**
   * 获取实例所有进程源的运行统计信息。
   *
   * @param instanceId - 实例 ID。
   * @returns 各进程源的 ProcessStats 组合对象。
   */
  getStats(instanceId: string): InstanceStats {
    const stats = {} as InstanceStats;
    for (const source of SOURCES)
      stats[source] = this.helper.getStats(this.key(instanceId, source));
    return stats;
  }

  /**
   * 导出指定进程源的日志到文件。
   *
   * 导出时会移除 ANSI 转义序列并以 `<name>_<source>_<timestamp>.log` 命名。
   *
   * @param instanceId - 实例 ID。
   * @param source - 进程源。
   * @returns 导出文件的绝对路径。
   * @throws {MofoxError} 日志为空时抛出 `NOT_FOUND`。
   */
  async exportLogs(instanceId: string, source: InstanceProcessSource): Promise<string> {
    const instance = await this.find(instanceId);
    const content = stripAnsi(this.getLogBuffer(instanceId, source));
    if (!content.trim()) throw new MofoxError('NOT_FOUND', '当前没有可导出的日志');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = instance.name.replace(/[^\p{L}\p{N}._-]+/gu, '_') || instance.id;
    return this.writeExport(`${safeName}_${source}_${timestamp}.log`, content);
  }

  // ── Command resolution ────────────────────────────────────────────

  /**
   * 解析实例的启动命令集合。
   *
   * MoFox 本体进程：当 `mofoxInstallDir/main.py` 存在时启动（venv python 优先，uv 回退）。
   * 平台进程：遍历 `platforms` 字典，逐个用平台安装目录调用对应平台的 `getStartCommand`。
   * v4 起平台路径和版本均来自 `platforms` 描述对象，不再回退到兄弟目录。
   *
   * @param instance - 待启动的实例。
   * @returns 进程源到启动命令的映射；无可用入口时为空集合。
   */
  private async resolveCommands(
    instance: Instance,
  ): Promise<Map<InstanceProcessSource, StartCommand>> {
    const commands = new Map<InstanceProcessSource, StartCommand>();

    const mofoxCommand = await this.resolveCommand(instance, 'mofox');
    if (mofoxCommand) commands.set('mofox', mofoxCommand);

    try {
      const platformCommand = await this.resolveCommand(instance, 'platform');
      if (platformCommand) commands.set('platform', platformCommand);
    } catch (error) {
      // 平台缺失不是致命错误：当 MoFox 本体能独立启动时允许仅启动 MoFox。
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

  /**
   * 解析单个进程源的启动命令。
   *
   * MoFox 本体进程：当 `mofoxInstallDir/main.py` 存在时返回命令（venv python 优先，uv 回退）。
   * 平台进程：遍历平台对象用安装目录调用对应平台的 `getStartCommand`；平台入口缺失时抛错。
   *
   * @param instance - 待解析的实例。
   * @param source - 进程源（`mofox` 或 `platform`）。
   * @returns 该源的启动命令；该源未配置安装目录时返回 `undefined`。
   * @throws {MofoxError} 平台已配置但启动入口解析失败时抛出。
   */
  private async resolveCommand(
    instance: Instance,
    source: InstanceProcessSource,
  ): Promise<StartCommand | undefined> {
    if (source === 'mofox') {
      const mofoxDir = instance.mofoxInstallDir;
      if (!mofoxDir || !(await exists(join(mofoxDir, 'main.py')))) return undefined;
      const venvPython = await findVenvPython(mofoxDir);
      const env = {
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1',
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
      };
      return venvPython
        ? { command: venvPython, args: ['main.py'], cwd: mofoxDir, env }
        : { command: 'uv', args: ['run', 'python', 'main.py'], cwd: mofoxDir, env };
    }

    // 平台路径的唯一来源是平铺的 platform 对象；未安装平台时仅启动 MoFox。
    const platform = instance.platform;
    if (!platform.id || !platform.installDir) return undefined;
    return this.registry.get(platform.id).getStartCommand(platform.installDir, instance.id);
  }

  // ── Process lifecycle ─────────────────────────────────────────────

  /**
   * 通过 ProcessHelper 启动实例进程源，并把输出、退出与启动失败回收到本服务的日志与状态收敛。
   *
   * @param instanceId - 所属实例 ID。
   * @param source - 进程来源，用于维护独立的运行状态与日志。
   * @param command - 已解析的启动命令。
   */
  private spawn(instanceId: string, source: InstanceProcessSource, command: StartCommand): void {
    const key = this.key(instanceId, source);
    this.helper.spawn(key, {
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      env: command.env ?? {},
      onData: (data) => this.appendLog(instanceId, source, data),
      onExit: ({ exitCode }) => {
        this.stoppingKeys.delete(key);
        void this.onSourceExit(instanceId, source, exitCode);
      },
      onError: (error) => {
        this.emitLauncherMessage(instanceId, source, 'error', `进程启动失败: ${error.message}`);
        this.stoppingKeys.delete(key);
        void this.onSourceExit(instanceId, source, 1);
      },
    });
    let set = this.running.get(instanceId);
    if (!set) {
      set = new Set();
      this.running.set(instanceId, set);
    }
    set.add(source);
  }

  /**
   * 进程源退出后的状态收敛：仅当实例全部进程源退出才同步最终状态，避免双进程场景提前显示已停止。
   *
   * @param instanceId - 所属实例 ID。
   * @param source - 已退出的进程源。
   * @param exitCode - 进程退出码。
   */
  private async onSourceExit(
    instanceId: string,
    source: InstanceProcessSource,
    exitCode: number,
  ): Promise<void> {
    const set = this.running.get(instanceId);
    if (!set || !set.delete(source)) return;
    const stopping = this.stoppingKeys.has(this.key(instanceId, source));
    if (!stopping) {
      if (exitCode === 0) this.emitLauncherMessage(instanceId, source, 'info', '进程已退出');
      else
        this.emitLauncherMessage(instanceId, source, 'error', `进程异常退出，退出码 ${exitCode}`);
    }
    if (set.size === 0) {
      this.running.delete(instanceId);
      const instance = await this.find(instanceId);
      if (instance.status === 'stopping' || instance.status === 'stopped') {
        if (instance.status !== 'stopped') await this.saveStatus(instance, 'stopped');
      } else {
        await this.saveStatus(instance, stopping || exitCode === 0 ? 'stopped' : 'error');
      }
    }
  }

  private hasActive(instanceId: string): boolean {
    return (this.running.get(instanceId)?.size ?? 0) > 0;
  }

  private appendLog(instanceId: string, source: InstanceProcessSource, data: string): void {
    // 内存日志有上限，实时片段仍通过事件通道发送，供终端视图增量渲染。
    const key = this.key(instanceId, source);
    const output = `${this.logBuffers.get(key) ?? ''}${data}`;
    this.logBuffers.set(
      key,
      output.length > LOG_BUFFER_MAX ? output.slice(-LOG_BUFFER_MAX) : output,
    );
    this.events.ptyData(instanceId, source, data);
  }

  /**
   * 在实例日志流中插入带时间前缀、颜色转义序列的启动器消息。
   *
   * @param instanceId - 实例 ID。
   * @param source - 进程源。
   * @param level - 消息级别（info/success/warn/error）。
   * @param message - 消息文本。
   */
  private emitLauncherMessage(
    instanceId: string,
    source: InstanceProcessSource,
    level: 'info' | 'success' | 'warn' | 'error',
    message: string,
  ): void {
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    } as const;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.appendLog(
      instanceId,
      source,
      `\x1b[90m${time}\x1b[0m ${colors[level]}[Launcher]\x1b[0m ${message}\r\n`,
    );
  }

  /**
   * 按 ID 从仓库查找实例，空 ID 或不存在时抛错。
   *
   * @param instanceId - 实例 ID。
   * @returns 匹配的实例记录。
   * @throws {MofoxError} 空 ID 抛 `INVALID_ARGUMENT`；未找到抛 `NOT_FOUND`。
   */
  private async find(instanceId: string): Promise<Instance> {
    if (!instanceId.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
    const instance = (await this.repository.list()).find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance) throw new MofoxError('NOT_FOUND', `未知实例: ${instanceId}`);
    return instance;
  }

  /**
   * 先持久化实例状态再广播事件，确保渲染端收到通知后读取到的状态一致。
   * 启动时会同步更新最后启动时间。
   *
   * @param instance - 当前实例记录。
   * @param status - 目标生命周期状态。
   */
  private async saveStatus(instance: Instance, status: InstanceStatus): Promise<void> {
    // 先落库再发事件，确保渲染进程收到状态后重新读取也能得到一致结果。
    await this.repository.update(instance.id, {
      status,
      ...(status === 'running' ? { lastStartedAt: Date.now() } : {}),
    });
    this.events.statusChanged(instance.id, status);
  }

  /**
   * 构造进程键，区分不同实例的不同进程源。
   *
   * @param instanceId - 实例 ID。
   * @param source - 进程源。
   * @returns `${instanceId}:${source}` 形式的字符串键。
   */
  private key(instanceId: string, source: InstanceProcessSource): string {
    return `${instanceId}:${source}`;
  }
}

/**
 * 检查路径是否可访问。
 *
 * @param path - 待检查的路径。
 * @returns 路径存在返回 `true`，否则返回 `false`。
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 移除字符串中的 ANSI 转义序列（CSI 与单字符转义）。
 *
 * @param value - 可能包含 ANSI 转义的字符串。
 * @returns 已剥离转义序列的纯文本。
 */
function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  // CSI sequence first so the single-char alternative cannot eat the leading '['.
  return value.replace(new RegExp(`${escape}(?:\\[[0-?]*[ -/]*[@-~]|[@-_])`, 'g'), '');
}
