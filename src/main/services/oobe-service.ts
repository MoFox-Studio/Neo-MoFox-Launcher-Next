import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MofoxError } from '../../shared/domain/error';
import type { OobeCompletionSummary, OobeDependencyStatus, OobeProgress } from '../../shared/domain/oobe';
import type { LegacyLauncherInfo } from '../../shared/domain/instance';
import type { SystemEnvInfo } from '../../shared/domain/system-env';
import {
  DEPENDENCY_INSTALLERS,
  type DependencyInstaller,
  type DependencyInstallContext,
} from '../utils/oobe';
import { isLinux } from '../utils/platform-helper';
import { runOneShot } from '../utils/process-service';
import type { SettingsService } from './settings-service';
import type { LegacyMigrationService } from './legacy-migration-service';

/**
 * OOBE（Out-of-Box Experience）服务：协调首次启动时的依赖安装、旧版检测与完成标记。
 *
 * 依赖是否已安装统一由 `EnvironmentService.detect()` 探测（`SystemEnvInfo` 中的
 * `gitVersion` / `pythonVersion` / `uvVersion`），安装器只负责安装；sudo 密码仅在内存中
 * 保留，依赖安装完成后立即清零，不写入持久化存储。
 */
export interface OobeEvents {
  progress(event: OobeProgress): void;
}

export interface OobeDependencies {
  settings: SettingsService;
  legacy: LegacyMigrationService;
  mirrors: { list(): { id: string; type: 'github' | 'python-ftp'; name: string; baseUrl: string }[] };
  /** 环境检测服务，用于在安装前后判断各依赖是否已可用。 */
  environment: { detect(): Promise<SystemEnvInfo> };
  now?: () => number;
  tempRoot?: string;
}

export class OobeService {
  /** 当前安装会话的 sudo 密码；安装完成或显式清理后置空。 */
  private sudoPassword: string | undefined;
  /** 当前安装会话的工作目录；安装结束后回收。 */
  private workDir: string | undefined;
  /** 取消信号；安装阶段触发后立即中止。 */
  private abortController: AbortController | undefined;
  /** 当前安装会话累积的日志行；随进度事件推送，失败时一并塞入错误对象。 */
  private logs: string[] = [];

  /**
   * @param dependencies - 设置、迁移、镜像、环境检测等服务依赖的注入点。
   * @param events - OOBE 进度事件分发回调。
   */
  constructor(
    private readonly dependencies: OobeDependencies,
    private readonly events: OobeEvents,
  ) {}

  /**
   * 验证用户输入的 sudo 密码是否可用。
   *
   * 仅 Linux 通过 `sudo -S -v` 验证；其他平台的依赖安装不需要 sudo。
   * 验证通过后密码保留在内存中供后续安装使用，直到 `installDependencies` 完成或 `clearSudoPassword` 调用。
   *
   * @param password - 用户输入的 sudo 密码。
   * @returns 密码可用时返回 `true`；不可用或验证失败时返回 `false`。
   */
  async verifySudoPassword(password: string): Promise<boolean> {
    if (!isLinux()) return true;
    if (!password) return false;
    try {
      // `sudo -S -k -v` 先用 -k 清除 sudo 时间戳，再用 -v 从 stdin 读取密码重新验证。
      // 不加 -k 时若近期已通过 sudo，-v 会直接成功而不验证密码本身。
      const result = await runOneShot('sudo', ['-S', '-k', '-v'], {
        timeoutMs: 10_000,
        input: `${password}\n`,
      });
      if (result.exitCode !== 0) return false;
      this.sudoPassword = password;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清空内存中的 sudo 密码；OOBE 流程结束或异常退出时调用。
   */
  clearSudoPassword(): void {
    this.sudoPassword = undefined;
  }

  /**
   * 仅探测依赖状态，不触发安装。
   *
   * 已存在的依赖标记为 `skipped`，缺失依赖保留为 `pending`，由渲染端在用户确认后
   * 再调用 `installDependencies()`。探测失败时保守地将所有依赖标记为待安装。
   */
  async inspectDependencies(): Promise<OobeDependencyStatus[]> {
    const env = await this.detectEnvironmentSafely();
    return DEPENDENCY_INSTALLERS.map((installer) => {
      const version = env ? dependencyVersion(installer.id, env) : undefined;
      return version
        ? {
            id: installer.id,
            displayName: installer.displayName,
            status: 'skipped',
            version,
            message: `已安装 ${version}`,
          }
        : {
            id: installer.id,
            displayName: installer.displayName,
            status: 'pending',
            message: '未安装',
          };
    });
  }

  /**
   * 探测并安装全部依赖；已安装的依赖跳过，未安装的逐个执行。
   *
   * 每个依赖的进度通过 `OobeProgress` 事件实时推送；任一依赖失败时立即停止后续安装。
   * 依赖是否已安装由 `EnvironmentService.detect()` 统一探测，安装器只负责安装。
   *
   * @returns 安装完成后的全部依赖状态汇总。
   */
  async installDependencies(): Promise<OobeDependencyStatus[]> {
    this.abortController = new AbortController();
    this.workDir = await mkdtemp(join(this.dependencies.tempRoot ?? tmpdir(), 'neo-mofox-oobe-'));
    this.logs = [];
    const mirrors = this.dependencies.mirrors.list();
    const statuses: OobeDependencyStatus[] = DEPENDENCY_INSTALLERS.map((installer) => ({
      id: installer.id,
      displayName: installer.displayName,
      status: 'pending',
    }));

    try {
      // 安装前统一探测一次环境，决定每个依赖是跳过还是安装；探测本身失败则全部进入安装。
      const env = await this.detectEnvironmentSafely();
      for (let index = 0; index < DEPENDENCY_INSTALLERS.length; index += 1) {
        if (this.abortController.signal.aborted) break;
        const installer = DEPENDENCY_INSTALLERS[index];
        const status = statuses[index];
        await this.processInstaller(installer, status, statuses, mirrors, env);
      }
    } finally {
      await this.disposeWorkspace();
      // 安装完成（无论成功失败）后立即清空密码，避免长期持有。
      this.sudoPassword = undefined;
    }
    return statuses;
  }

  /**
   * 取消正在进行的安装流程。
   */
  async cancel(): Promise<void> {
    this.abortController?.abort();
  }

  /**
   * 完成 OOBE 流程：探测旧启动器并将 `settings.oobeCompleted` 置为 `true`。
   *
   * 旧版导入不在此处执行，仅返回检测结果，由 UI 决定后续步骤。
   *
   * @returns OOBE 完成摘要，含依赖最终状态与旧启动器探测结果。
   */
  async complete(): Promise<OobeCompletionSummary> {
    const dependencies = await this.collectDependencyStatuses();
    let legacy: LegacyLauncherInfo | null = null;
    try {
      legacy = await this.dependencies.legacy.detect();
    } catch {
      // 旧版探测失败不应阻断 OOBE 完成；将 legacy 保持为 null 即可。
    }
    await this.dependencies.settings.update({ oobeCompleted: true });
    this.clearSudoPassword();
    return { completed: true, dependencies, legacy };
  }

  /**
   * 执行单个依赖的探测与安装，并更新其状态字段。
   *
   * 是否已安装由传入的 `env`（来自 `EnvironmentService.detect()`）决定，安装器不再各自探测；
   * 快照传入完整 `statuses` 数组而非单个 `status`，确保进度事件能保留此前已解析的依赖状态，
   * 避免后续依赖在安装时把前序依赖回退为 `pending` 显示。
   */
  private async processInstaller(
    installer: DependencyInstaller,
    status: OobeDependencyStatus,
    statuses: OobeDependencyStatus[],
    mirrors: DependencyInstallContext['mirrors'],
    env: SystemEnvInfo | undefined,
  ): Promise<void> {
    const detected = env ? dependencyVersion(installer.id, env) : undefined;
    if (detected) {
      status.status = 'skipped';
      status.version = detected;
      status.message = `已安装 ${detected}`;
      this.log(`${installer.displayName} 已存在 (${detected})，跳过`);
      this.emit({ phase: 'installing', message: `${installer.displayName} 已存在，跳过`, progress: 1, dependencies: this.snapshot(statuses) });
      return;
    }

    status.status = 'installing';
    this.log(`开始安装 ${installer.displayName}`);
    this.emit({ phase: 'installing', dependencyId: installer.id, message: `正在安装 ${installer.displayName}...`, progress: -1, dependencies: this.snapshot(statuses) });

    const context: DependencyInstallContext = {
      workDir: this.workDir ?? tmpdir(),
      mirrors,
      sudoPassword: this.sudoPassword,
      signal: this.abortController?.signal,
      onProgress: (message, progress) => {
        this.log(`[${installer.displayName}] ${message}`);
        this.emit({
          phase: 'installing',
          dependencyId: installer.id,
          message,
          progress: progress ?? -1,
          dependencies: this.snapshot(statuses),
        });
      },
    };

    try {
      const version = await installer.install(context);
      status.status = 'installed';
      status.version = version;
      status.message = '安装完成';
      this.log(`${installer.displayName} 安装完成 (${version})`);
      this.emit({ phase: 'installing', dependencyId: installer.id, message: `${installer.displayName} 安装完成`, progress: 1, dependencies: this.snapshot(statuses) });
    } catch (error) {
      status.status = 'failed';
      status.message = error instanceof Error ? error.message : String(error);
      this.log(`${installer.displayName} 安装失败: ${status.message}`);
      this.emit({ phase: 'error', dependencyId: installer.id, message: `${installer.displayName} 安装失败: ${status.message}`, progress: -1, dependencies: this.snapshot(statuses) });
      throw this.wrapWithLogs(error);
    }
  }

  /**
   * 重新探测环境并据此生成完成摘要。
   *
   * 完成 OOBE 前重新探测而非复用安装阶段结果，可捕获安装阶段后续被外部修改的情形；
   * 探测失败时该依赖标记为 `failed`。
   */
  private async collectDependencyStatuses(): Promise<OobeDependencyStatus[]> {
    const env = await this.detectEnvironmentSafely();
    return DEPENDENCY_INSTALLERS.map((installer) => {
      const detected = env ? dependencyVersion(installer.id, env) : undefined;
      return {
        id: installer.id,
        displayName: installer.displayName,
        status: detected ? 'installed' : 'failed',
        ...(detected ? { version: detected } : {}),
      };
    });
  }

  /**
   * 调用 `EnvironmentService.detect()` 并将异常统一降级为 `undefined`。
   *
   * 环境探测失败不应阻断 OOBE 流程；返回 `undefined` 时所有依赖将进入安装分支。
   */
  private async detectEnvironmentSafely(): Promise<SystemEnvInfo | undefined> {
    try {
      return await this.dependencies.environment.detect();
    } catch {
      return undefined;
    }
  }

  /** 释放当前安装会话的临时目录与取消信号。 */
  private async disposeWorkspace(): Promise<void> {
    this.abortController = undefined;
    if (this.workDir) {
      await rm(this.workDir, { recursive: true, force: true }).catch(() => undefined);
      this.workDir = undefined;
    }
  }

  /** 复制当前状态快照，避免事件订阅方就地修改内部状态。 */
  private snapshot(statuses: OobeDependencyStatus[]): OobeDependencyStatus[] {
    return statuses.map((status) => ({
      id: status.id,
      displayName: status.displayName,
      status: status.status,
      ...(status.version ? { version: status.version } : {}),
      ...(status.message ? { message: status.message } : {}),
    }));
  }

  /**
   * 追加一行日志到当前安装会话；同时随下一次进度事件推送。
   *
   * 日志保留时间戳前缀，便于失败时定位时序；不直接打 console，避免主进程 stdout 噪音。
   */
  private log(line: string): void {
    const stamp = new Date().toISOString();
    this.logs.push(`[${stamp}] ${line}`);
  }

  /**
   * 把累积日志塞入异常的 `details.logs`；非 MofoxError 包装为 IO_ERROR 以承载 details。
   *
   * 渲染端可通过 `error.details.logs` 拿到完整日志，展示在错误弹窗的日志框中。
   */
  private wrapWithLogs(error: unknown): MofoxError {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof MofoxError ? error.code : 'IO_ERROR';
    const details = { ...(error instanceof MofoxError && error.details ? error.details : {}), logs: [...this.logs] };
    return new MofoxError(code, message, details);
  }

  /**
   * 分发进度事件；每次推送时附带当前安装会话的累积日志快照。
   *
   * @param event - 待推送的进度事件（不含 logs 字段；方法内部追加日志快照）。
   */
  private emit(event: OobeProgress): void {
    this.events.progress({ ...event, logs: [...this.logs] });
  }
}

/** 仅 Linux 的系统包安装需要通过 sudo 提权。 */
export function oobeNeedsSudoPassword(): boolean {
  return isLinux();
}

/** 依赖 ID 到 `SystemEnvInfo` 版本字段的映射；未识别的 ID 返回 `undefined`。 */
function dependencyVersion(id: string, env: SystemEnvInfo): string | undefined {
  switch (id) {
    case 'git':
      return env.gitVersion;
    case 'python':
      return env.pythonVersion;
    case 'uv':
      return env.uvVersion;
    default:
      return undefined;
  }
}
