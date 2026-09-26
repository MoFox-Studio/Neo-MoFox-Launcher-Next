import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import type { Instance, InstanceTerminalDirKind } from '../../shared/domain/instance';
import type { TerminalShellOption } from '../../shared/domain/terminal-shell';
import { MofoxError } from '../../shared/domain/error';
import type { ProcessIdentity } from '../utils/process-helper';
import { isWindows, venvPythonOf } from '../utils/platform-helper';
import { detectTerminalShells } from '../utils/terminal-shells';
import { requireDirectory } from '../utils/path-inspection';

/**
 * 终端服务依赖的最小进程管理能力；生产环境由主进程的 ProcessHelper 提供，
 * 与实例运行时共享同一进程表（键空间相互隔离），测试可注入替身。
 */
export interface TerminalProcessHost {
  spawn(
    key: string,
    options: {
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      onData: (data: string) => void;
      onExit: (event: { exitCode: number; signal?: number }, identity: ProcessIdentity) => void;
      onError: (error: Error, identity: ProcessIdentity) => void;
    },
  ): ProcessIdentity;
  killAll(key?: string): void;
  write(key: string, data: string): void;
  resize(key: string, cols: number, rows: number): void;
  has(key: string): boolean;
}

/** 终端服务向渲染进程推送的事件集合；由组合根转发到主窗口。 */
export interface InstanceTerminalEvents {
  /** 终端输出增量数据。 */
  data: (instanceId: string, data: string) => void;
  /** 当前会话退出；切换目录或关闭面板触发的旧会话退出不会误报。 */
  exited: (instanceId: string, exitCode: number) => void;
}

/** 终端会话的初始列高。 */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/** 终端会话的初始列高。 */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/** 打开终端会话的可选参数。 */
export interface TerminalSessionOptions {
  /** 目标 shell ID；缺省时使用系统默认 shell。 */
  shellId?: string;
  /** 终端初始列高。 */
  size?: TerminalSize;
}

/**
 * 实例终端服务：为每个实例维护一个交互式 shell 会话。
 *
 * 终端与实例进程（mofox/platform 源）使用同一 ProcessHelper 但键空间独立
 * （`terminal:<instanceId>`），因此同时最多一个会话，且随启动器退出统一回收。
 * 会话始终激活实例的虚拟环境（注入 VIRTUAL_ENV 并前置 venv 可执行目录），
 * 工作目录与终端程序（Bash、PowerShell 等）均可切换；任一变化都会终止旧
 * shell 并以新参数重启会话。关闭面板时由渲染端显式调用 close 销毁会话。
 */
export class InstanceTerminalService {
  /** 当前会话的单次 spawn 身份；用于过滤被替换旧会话的延迟退出事件。 */
  private readonly identities = new Map<string, ProcessIdentity>();

  constructor(
    private readonly repository: { list(): Promise<Instance[]> },
    private readonly helper: TerminalProcessHost,
    private readonly events: InstanceTerminalEvents,
    /** 探测可用 shell；独立注入便于测试在受控候选下运行。 */
    private readonly resolveShells: () => Promise<TerminalShellOption[]> = detectTerminalShells,
  ) {}

  /**
   * 列出当前系统可用的终端程序，供面板下拉框渲染。
   *
   * @returns 可用 shell 列表；恰好一项标记为默认。
   */
  async listShells(): Promise<TerminalShellOption[]> {
    return this.resolveShells();
  }

  /**
   * 打开实例终端；已有会话时先销毁再按新目录/终端程序重启。
   *
   * @param instanceId - 实例 ID。
   * @param kind - 目标工作目录种类。
   * @param options - 可选的 shell ID 与初始列高。
   * @returns 主进程校验后的实际工作目录。
   * @throws {MofoxError} 实例不存在、目录未配置、目录缺失或终端程序未知时抛出。
   */
  async open(
    instanceId: string,
    kind: InstanceTerminalDirKind,
    options?: TerminalSessionOptions,
  ): Promise<{ cwd: string }> {
    const instance = await this.find(instanceId);
    const cwd = await resolveWorkingDir(instance, kind);
    const shell = await this.resolveSessionShell(options?.shellId);
    const key = this.key(instanceId);
    // 切换目录/终端程序即重启会话：交互 shell 无状态需要保护，立即强杀旧进程树最快。
    if (this.helper.has(key)) {
      this.identities.delete(key);
      this.helper.killAll(key);
    }
    if (options?.size) this.helper.resize(key, options.size.cols, options.size.rows);
    const env = await buildSessionEnv(instance);
    const identity = this.helper.spawn(key, {
      command: shell.command,
      args: shell.args,
      cwd,
      env,
      onData: (data) => this.events.data(instanceId, data),
      onExit: ({ exitCode }, exitedIdentity) => {
        // 旧会话被替换后的延迟退出事件不得误报为新会话结束。
        if (this.identities.get(key) !== exitedIdentity) return;
        this.identities.delete(key);
        this.events.exited(instanceId, exitCode);
      },
      onError: (_error, failedIdentity) => {
        if (this.identities.get(key) !== failedIdentity) return;
        this.identities.delete(key);
        // 会话未能启动时以非零码通知渲染端；此处不再抛出，避免回调上下文中的未捕获异常。
        this.events.exited(instanceId, 1);
      },
    });
    this.identities.set(key, identity);
    return { cwd };
  }

  /**
   * 向实例终端会话写入输入数据；会话不存在时静默丢弃。
   *
   * @param instanceId - 实例 ID。
   * @param data - 待写入 PTY 的字符串数据。
   */
  write(instanceId: string, data: string): void {
    this.helper.write(this.key(instanceId), data);
  }

  /**
   * 调整实例终端会话的列高；参数由 IPC 边界校验。
   *
   * @param instanceId - 实例 ID。
   * @param cols - 列数。
   * @param rows - 行数。
   */
  resize(instanceId: string, cols: number, rows: number): void {
    this.helper.resize(this.key(instanceId), cols, rows);
  }

  /**
   * 关闭并销毁实例终端会话；离开终端面板时由渲染端调用。
   *
   * @param instanceId - 实例 ID。
   */
  async close(instanceId: string): Promise<void> {
    const key = this.key(instanceId);
    this.identities.delete(key);
    this.helper.killAll(key);
  }

  /**
   * 构造终端进程键，与实例运行时进程键相互隔离。
   *
   * @param instanceId - 实例 ID。
   * @returns `terminal:<instanceId>` 形式的字符串键。
   */
  private key(instanceId: string): string {
    return `terminal:${instanceId}`;
  }

  /**
   * 解析会话使用的 shell：缺省取系统默认，未知 ID 抛错。
   *
   * @param shellId - 渲染端选择的 shell ID；可为空。
   * @returns 解析后的 shell 描述。
   * @throws {MofoxError} 系统无可用 shell 抛 `UNAVAILABLE`；ID 未知抛 `INVALID_ARGUMENT`。
   */
  private async resolveSessionShell(shellId?: string): Promise<TerminalShellOption> {
    const shells = await this.resolveShells();
    if (shells.length === 0) throw new MofoxError('UNAVAILABLE', '未找到可用的终端程序');
    if (!shellId?.trim()) {
      return shells.find((shell) => shell.isDefault) ?? shells[0];
    }
    const shell = shells.find((candidate) => candidate.id === shellId);
    if (!shell) throw new MofoxError('INVALID_ARGUMENT', `未知终端程序: ${shellId}`);
    return shell;
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
}

/**
 * 按目录种类解析并校验终端工作目录。
 *
 * 所有路径以实例记录为唯一来源；主程序与平台目录必须已存在，
 * venv 目录同样要求已创建（尚未同步依赖时给出可读错误而非 spawn 失败）。
 *
 * @param instance - 目标实例。
 * @param kind - 目标工作目录种类。
 * @returns 校验后的绝对目录路径。
 */
async function resolveWorkingDir(
  instance: Instance,
  kind: InstanceTerminalDirKind,
): Promise<string> {
  if (kind === 'venv') {
    const venvDir = instance.venvDir.trim();
    if (!venvDir) throw new MofoxError('INVALID_ARGUMENT', '实例未配置虚拟环境目录');
    return requireDirectory(venvDir, '虚拟环境目录');
  }
  if (kind === 'platform') {
    const platformDir = instance.platform.installDir?.trim();
    if (!platformDir) throw new MofoxError('NOT_FOUND', '实例未安装平台适配器');
    return requireDirectory(platformDir, '平台目录');
  }
  return requireDirectory(instance.mofoxInstallDir, '主程序目录');
}

/**
 * 构造终端会话环境变量。
 *
 * 终端始终处于实例虚拟环境上下文：解释器存在时注入 `VIRTUAL_ENV` 并把 venv
 * 可执行目录前置到 `PATH`，等效于 `source activate`，与当前工作目录无关。
 * 解释器缺失时不注入，避免把失效路径塞进 `PATH`。
 *
 * @param instance - 目标实例。
 * @returns 传给 PTY 的环境变量。
 */
async function buildSessionEnv(instance: Instance): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
  };
  const venvDir = instance.venvDir.trim();
  if (venvDir && (await venvPythonOf(venvDir))) {
    const binDir = join(venvDir, isWindows() ? 'Scripts' : 'bin');
    env.VIRTUAL_ENV = venvDir;
    env.PATH = [binDir, ...userPathAdditions(), process.env.PATH ?? '']
      .filter(Boolean)
      .join(delimiter);
  }
  return env;
}

/**
 * 非 Windows 上补齐常见用户级可执行目录；与 `buildSpawnEnv` 的兜底策略一致。
 *
 * GUI 启动的进程缺少交互 shell 注入的 PATH，兜底保证 uv、git 等用户安装的
 * 工具在终端内可直接使用。
 *
 * @returns 需要前置到 `PATH` 的用户目录列表。
 */
function userPathAdditions(): string[] {
  if (isWindows()) return [];
  return ['.cargo/bin', '.local/bin', 'bin'].map((directory) => join(homedir(), directory));
}
