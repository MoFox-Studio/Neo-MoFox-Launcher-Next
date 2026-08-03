import { constants } from 'node:fs';
import { access, cp, mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { InstallContext, InstallResult } from '../../shared/domain/bot-platform';
import type {
  Instance,
  InstallProgressEvent,
  InstallRequest,
  InstallStepId,
} from '../../shared/domain/instance';
import type { MirrorSource } from '../../shared/domain/mirror';
import { MofoxError } from '../../shared/domain/error';
import type { PlatformRegistry } from '../platforms/registry';

/**
 * 将平台安装拆为可观察、可重试的步骤状态机；进度事件是主进程到渲染进程的状态同步边界。
 * 工作目录始终位于临时区，成功后再以暂存目录提交目标路径，失败和取消均回收临时资源。
 */
const STEPS: readonly InstallStepId[] = [
  'prepare',
  'download',
  'extract',
  'dependencies',
  'configure',
  'finalize',
];

interface TaskRecord {
  id: string;
  request: InstallRequest;
  workDir: string;
  controller: AbortController;
  status: InstallProgressEvent['status'];
  currentStep: InstallStepId;
  failedStep?: InstallStepId;
  result?: InstallResult;
  running: Promise<void>;
}

export interface InstallTaskEvents {
  progress(event: InstallProgressEvent): void;
}

export interface InstallTaskDependencies {
  repository: { upsert(instance: Instance): Promise<void> };
  mirrors: { list(): MirrorSource[] };
  now?: () => number;
  tempRoot?: string;
}

export class InstallTaskService {
  private readonly tasks = new Map<string, TaskRecord>();
  private nextId = 1;

  constructor(
    private readonly registry: PlatformRegistry,
    private readonly dependencies: InstallTaskDependencies,
    private readonly events: InstallTaskEvents,
  ) {}

  /**
   * 启动新的安装任务并立即返回任务 ID。
   *
   * 任务在后台异步执行，进度通过 `InstallTaskEvents.progress` 事件同步给渲染端。
   *
   * @param request - 安装请求载荷（实例名、平台、版本、目标目录等）。
   * @returns 新建任务的唯一 ID。
   */
  async start(request: InstallRequest): Promise<string> {
    validateRequest(request);
    const task = this.createTask(request);
    this.tasks.set(task.id, task);
    task.running = this.execute(task, 0);
    return task.id;
  }

  /**
   * 从失败步骤继续执行安装任务。
   *
   * 保留已完成下载结果，避免无意义地重做前序步骤。
   *
   * @param taskId - 待重试的任务 ID。
   * @throws {MofoxError} 任务不存在或非失败状态时抛出 `CONFLICT`/`NOT_FOUND`。
   */
  async retry(taskId: string): Promise<void> {
    // 从失败步骤继续，保留已完成下载结果，避免无意义地重做前序步骤。
    const task = this.requireTask(taskId);
    if (task.status !== 'failed' || !task.failedStep)
      throw new MofoxError('CONFLICT', '只有失败任务可以重试');
    task.controller = new AbortController();
    task.status = 'running';
    const startIndex = STEPS.indexOf(task.failedStep);
    task.running = this.execute(task, startIndex);
    await task.running;
  }

  /**
   * 取消指定任务并清理临时工作目录。
   *
   * 已完成或已取消的任务直接返回；其余任务通过 AbortSignal 中止，并发布取消状态事件。
   *
   * @param taskId - 待取消的任务 ID。
   */
  async cancel(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    if (task.status === 'done' || task.status === 'cancelled') return;
    task.controller.abort();
    await task.running.catch(() => undefined);
    task.status = 'cancelled';
    this.emit(task, task.failedStep ?? 'prepare', -1, 'cancelled', '安装已取消');
    await rm(task.workDir, { recursive: true, force: true });
  }

  /**
   * 取消所有未完成任务，常用于窗口关闭前的资源回收。
   *
   * @returns 所有任务取消完成后的 Promise。
   */
  async cancelAll(): Promise<void> {
    await Promise.all([...this.tasks.keys()].map((taskId) => this.cancel(taskId)));
  }

  /**
   * 判断是否存在仍可取消或正在执行的任务。
   *
   * @returns 存在 pending/running 状态任务时返回 `true`。
   */
  hasActiveTasks(): boolean {
    return [...this.tasks.values()].some(
      (task) => task.status === 'pending' || task.status === 'running',
    );
  }

  /**
   * 等待指定任务运行态完成（done/failed/cancelled 均会 resolve）。
   *
   * @param taskId - 待等待的任务 ID。
   */
  async wait(taskId: string): Promise<void> {
    await this.requireTask(taskId).running;
  }

  private createTask(request: InstallRequest): TaskRecord {
    const id = `install-${this.nextId++}`;
    const root = this.dependencies.tempRoot ?? tmpdir();
    return {
      id,
      request,
      workDir: join(root, `neo-mofox-${id}`),
      controller: new AbortController(),
      status: 'pending',
      currentStep: 'prepare',
      running: Promise.resolve(),
    };
  }

  private async execute(task: TaskRecord, startIndex: number): Promise<void> {
    task.status = 'running';
    try {
      for (let index = startIndex; index < STEPS.length; index += 1) {
        this.throwIfCancelled(task);
        const step = STEPS[index];
        task.currentStep = step;
        this.emit(task, step, 0, 'running', `开始${step}步骤`);
        if (step === 'prepare') await mkdir(join(task.workDir, 'payload'), { recursive: true });
        if (step === 'download') task.result = await this.installPlatform(task);
        if (step === 'extract') this.emit(task, step, 1, 'running', '平台文件已解压');
        if (step === 'dependencies') this.emit(task, step, 1, 'running', '依赖准备完成');
        if (step === 'configure') await this.configurePlatform(task);
        if (step === 'finalize') await this.finalize(task);
        this.emit(task, step, 1, 'running', `${step}步骤完成`);
      }
      task.status = 'done';
      this.emit(task, 'finalize', 1, 'done', '安装完成');
      await rm(task.workDir, { recursive: true, force: true });
    } catch (error) {
      // 取消不是失败：平台可通过 AbortSignal 尽快停止，任务对外发布取消状态而非错误。
      if (task.controller.signal.aborted) {
        task.status = 'cancelled';
        await rm(task.workDir, { recursive: true, force: true });
        return;
      }
      task.status = 'failed';
      task.failedStep = task.currentStep;
      const step = task.failedStep;
      this.emit(task, step, -1, 'failed', error instanceof Error ? error.message : String(error));
    }
  }

  private async installPlatform(task: TaskRecord): Promise<InstallResult> {
    const platform = this.registry.get(task.request.platformId);
    const context: InstallContext = {
      instanceId: task.id,
      version: task.request.version,
      workDir: task.workDir,
      targetDir: join(task.workDir, 'payload'),
      mirrors: this.dependencies.mirrors.list(),
      signal: task.controller.signal,
    };
    return platform.install(context);
  }

  private async configurePlatform(task: TaskRecord): Promise<void> {
    const result = task.result;
    if (!result) throw new MofoxError('CONFLICT', '缺少平台安装结果');
    await this.registry.get(task.request.platformId).configure(task.id, result.installPath);
  }

  private async finalize(task: TaskRecord): Promise<void> {
    const result = task.result;
    if (!result) throw new MofoxError('CONFLICT', '缺少平台安装结果');
    const target = resolve(task.request.targetDir);
    const staging = `${target}.neo-mofox-staging-${task.id}`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(resolve(target, '..'), { recursive: true });
    // 暂存路径使目标目录只在安装完整后可见；跨设备时回退为复制再提交。
    try {
      await rename(result.installPath, staging);
      await rename(staging, target);
    } catch (error) {
      if (!isCrossDevice(error)) throw error;
      await cp(result.installPath, staging, { recursive: true, force: true });
      await rename(staging, target);
      await rm(result.installPath, { recursive: true, force: true });
    }
    await access(target, constants.F_OK);
    await this.dependencies.repository.upsert({
      id: task.id,
      name: task.request.instanceName,
      version: result.version,
      platformId: task.request.platformId,
      installPath: target,
      status: 'stopped',
      createdAt: this.dependencies.now?.() ?? Date.now(),
      autoStart: false,
    });
  }

  private emit(
    task: TaskRecord,
    step: InstallStepId,
    progress: number,
    status: InstallProgressEvent['status'],
    message: string,
  ): void {
    // 事件载荷保持完整步骤上下文，渲染端无需推断任务当前状态。
    this.events.progress({
      taskId: task.id,
      instanceName: task.request.instanceName,
      step,
      stepIndex: STEPS.indexOf(step),
      stepCount: STEPS.length,
      status,
      progress,
      message,
    });
  }

  private throwIfCancelled(task: TaskRecord): void {
    if (task.controller.signal.aborted) throw new MofoxError('CONFLICT', '安装已取消');
  }

  private requireTask(taskId: string): TaskRecord {
    if (!taskId.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Task ID is required');
    const task = this.tasks.get(taskId);
    if (!task) throw new MofoxError('NOT_FOUND', `未知安装任务: ${taskId}`);
    return task;
  }
}

/**
 * 校验安装请求的字段合法性与目标路径安全性。
 *
 * @param request - 待校验的安装请求。
 * @throws {MofoxError} 字段为空、目标路径非绝对路径或为文件系统根目录时抛出 `INVALID_ARGUMENT`。
 */
function validateRequest(request: InstallRequest): void {
  if (!request.instanceName.trim() || !request.platformId.trim() || !request.version.trim())
    throw new MofoxError('INVALID_ARGUMENT', '安装实例名、平台和版本不能为空');
  if (!isAbsolute(request.targetDir))
    throw new MofoxError('INVALID_ARGUMENT', '安装目标路径必须是绝对路径');
  if (resolve(request.targetDir) === resolve(request.targetDir, '..'))
    throw new MofoxError('INVALID_ARGUMENT', '安装目标路径不能是文件系统根目录');
}

/**
 * 判断错误是否为跨设备重命名（EXDEV）错误。
 *
 * @param error - 待判断的异常对象。
 * @returns 错误码为 `EXDEV` 时返回 `true`。
 */
function isCrossDevice(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EXDEV';
}
