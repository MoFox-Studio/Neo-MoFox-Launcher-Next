import { constants } from 'node:fs';
import { access, cp, mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { InstallContext, InstallResult } from '../../shared/domain/bot-platform';
import type { Instance, InstallProgressEvent, InstallRequest, InstallStepId } from '../../shared/domain/instance';
import { MofoxError } from '../../shared/domain/error';
import type { PlatformRegistry } from '../platforms/registry';

/**
 * 将平台安装拆为可观察、可重试的步骤状态机；进度事件是主进程到渲染进程的状态同步边界。
 * 工作目录始终位于临时区，成功后再以暂存目录提交目标路径，失败和取消均回收临时资源。
 */
const STEPS: readonly InstallStepId[] = ['prepare', 'download', 'extract', 'dependencies', 'configure', 'finalize'];

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

  async start(request: InstallRequest): Promise<string> {
    validateRequest(request);
    const task = this.createTask(request);
    this.tasks.set(task.id, task);
    task.running = this.execute(task, 0);
    return task.id;
  }

  async retry(taskId: string): Promise<void> {
    // 从失败步骤继续，保留已完成下载结果，避免无意义地重做前序步骤。
    const task = this.requireTask(taskId);
    if (task.status !== 'failed' || !task.failedStep) throw new MofoxError('CONFLICT', '只有失败任务可以重试');
    task.controller = new AbortController();
    task.status = 'running';
    const startIndex = STEPS.indexOf(task.failedStep);
    task.running = this.execute(task, startIndex);
    await task.running;
  }

  async cancel(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    if (task.status === 'done' || task.status === 'cancelled') return;
    task.controller.abort();
    await task.running.catch(() => undefined);
    task.status = 'cancelled';
    this.emit(task, task.failedStep ?? 'prepare', -1, 'cancelled', '安装已取消');
    await rm(task.workDir, { recursive: true, force: true });
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.tasks.keys()].map((taskId) => this.cancel(taskId)));
  }

  hasActiveTasks(): boolean {
    return [...this.tasks.values()].some((task) => task.status === 'pending' || task.status === 'running');
  }

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
      ...(task.request.mirrorId ? { mirrorId: task.request.mirrorId } : {}),
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

  private emit(task: TaskRecord, step: InstallStepId, progress: number, status: InstallProgressEvent['status'], message: string): void {
    // 事件载荷保持完整步骤上下文，渲染端无需推断任务当前状态。
    this.events.progress({ taskId: task.id, instanceName: task.request.instanceName, step, stepIndex: STEPS.indexOf(step), stepCount: STEPS.length, status, progress, message });
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

function validateRequest(request: InstallRequest): void {
  if (!request.instanceName.trim() || !request.platformId.trim() || !request.version.trim()) throw new MofoxError('INVALID_ARGUMENT', '安装实例名、平台和版本不能为空');
  if (!isAbsolute(request.targetDir)) throw new MofoxError('INVALID_ARGUMENT', '安装目标路径必须是绝对路径');
  if (resolve(request.targetDir) === resolve(request.targetDir, '..')) throw new MofoxError('INVALID_ARGUMENT', '安装目标路径不能是文件系统根目录');
}

function isCrossDevice(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EXDEV';
}
