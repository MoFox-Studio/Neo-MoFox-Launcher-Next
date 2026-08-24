import { constants } from 'node:fs';
import { access, cp, mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { CreateInstanceInput } from '../../shared/domain/instance';
import type {
  InstallProgressEvent,
  InstallRequest,
  InstallStepId,
  LicenseFetchResult,
} from '../../shared/domain/install';
import type { MirrorSource } from '../../shared/domain/mirror';
import { MofoxError } from '../../shared/domain/error';
import type { PlatformRegistry } from '../platforms/registry';
import { generateInstanceId } from '../utils/id-generator';
import { fetchRepositoryFile } from '../utils/github-installer';
import {
  configureInstance,
  installMoFox,
  installPlatform,
  installWebUi,
  type InstallTaskContext,
} from '../utils/install-tasks';

/**
 * 安装任务编排服务：把安装拆为「安装 MoFox → 安装平台 → 安装 WebUI → 配置」四个任务
 * 加一个收尾步骤，所有产物在临时工作区内的 stage 目录完成。
 *
 * 每一步完成后会把当前目录整体复制给下一步使用（设计文档要求），失败、取消或完成时
 * 一律回收整个临时工作区；主服务只负责调度与状态发布，具体逻辑全部委托给
 * `utils/install-tasks` 下的执行器。
 */

interface TaskSpec {
  step: InstallStepId;
  label: string;
}

interface TaskRecord {
  id: string;
  request: InstallRequest;
  /** 临时工作区根目录；内部分为 `stage-0..n` 快照目录。 */
  workspace: string;
  controller: AbortController;
  status: InstallProgressEvent['status'];
  currentStep: InstallStepId;
  currentIndex: number;
  /** 当前步骤内最近一次报告的 0..1 进度，日志行复用该值避免进度条闪烁。 */
  lastFraction: number;
  failedStep?: InstallStepId;
  /** 平台发行版本号；安装平台任务成功后记录，供注册实例回填。 */
  platformVersion?: string;
  running: Promise<void>;
}

export interface InstallTaskEvents {
  progress(event: InstallProgressEvent): void;
}

export interface InstallTaskDependencies {
  repository: { create(input: CreateInstanceInput): Promise<unknown> };
  mirrors: { list(): MirrorSource[] };
  tempRoot?: string;
  /** 可选执行器覆盖，供测试注入伪实现；缺省时使用 `utils/install-tasks` 中的真实执行器。 */
  executors?: Partial<Record<InstallStepId, (ctx: InstallTaskContext) => Promise<unknown>>>;
}

export class InstallTaskService {
  private readonly tasks = new Map<string, TaskRecord>();

  /**
   * @param registry - 平台注册表，用于按平台 ID 解析平台安装器。
   * @param dependencies - 仓库、镜像与临时目录等外部依赖的注入点。
   * @param events - 安装进度事件分发回调。
   */
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
   * @param request - 安装请求载荷（实例名、平台、分支、端口、密钥与目标目录等）。
   * @returns 新建任务的唯一 ID。
   */
  async start(request: InstallRequest): Promise<string> {
    validateRequest(request);
    const task = this.createTask(request);
    this.tasks.set(task.id, task);
    task.running = this.execute(task);
    return task.id;
  }

  /**
   * 重新执行失败任务。
   *
   * 由于流水线使用逐级复制的快照目录，重试从全新工作区重新开始。
   *
   * @param taskId - 待重试的任务 ID。
   * @throws {MofoxError} 任务不存在或非失败状态时抛出 `CONFLICT`/`NOT_FOUND`。
   */
  async retry(taskId: string): Promise<void> {
    const task = this.requireTask(taskId);
    if (task.status !== 'failed') throw new MofoxError('CONFLICT', '只有失败任务可以重试');
    task.controller = new AbortController();
    task.status = 'running';
    task.failedStep = undefined;
    task.platformVersion = undefined;
    task.running = this.execute(task);
    await task.running;
  }

  /**
   * 取消指定任务并清理临时工作区。
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
    await rm(task.workspace, { recursive: true, force: true }).catch(() => undefined);
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

  /**
   * 经镜像轮询拉取 MoFox 的两份协议文本，供安装向导展示。
   *
   * 最终用户许可协议与隐私政策均来自主程序仓库根目录。
   *
   * @returns 两份协议各自命中的镜像源名称与内容。
   */
  async fetchLicense(): Promise<LicenseFetchResult> {
    const mirrors = this.dependencies.mirrors.list();
    const [eula, privacy] = await Promise.all([
      fetchRepositoryFile({
        mirrors,
        repository: 'MoFox-Studio/Neo-MoFox',
        path: 'eula.md',
      }),
      fetchRepositoryFile({
        mirrors,
        repository: 'MoFox-Studio/Neo-MoFox',
        path: 'PRIVACY.md',
      }),
    ]);
    return { eula, privacy };
  }

  /**
   * 构造任务记录：生成唯一 ID、临时工作区与取消信号，不触发任何执行。
   *
   * @param request - 安装请求载荷。
   * @returns 处于 pending 状态的 `TaskRecord`。
   */
  private createTask(request: InstallRequest): TaskRecord {
    const id = generateInstanceId();
    const root = this.dependencies.tempRoot ?? tmpdir();
    return {
      id,
      request,
      workspace: join(root, `neo-mofox-install-${id}`),
      controller: new AbortController(),
      status: 'pending',
      currentStep: 'install-mofox',
      currentIndex: 0,
      lastFraction: 0,
      running: Promise.resolve(),
    };
  }

  /**
   * 按请求构造实际执行的步骤列表；未选择平台或 WebUI 时对应步骤被省略。
   *
   * @param request - 安装请求载荷。
   * @returns 顺序执行的任务规格列表。
   */
  private buildSteps(request: InstallRequest): TaskSpec[] {
    const steps: TaskSpec[] = [{ step: 'install-mofox', label: '安装 MoFox' }];
    if (request.platformId) steps.push({ step: 'install-platform', label: '安装平台' });
    if (request.installWebui) steps.push({ step: 'install-webui', label: '安装 WebUI' });
    steps.push({ step: 'configure', label: '配置' });
    steps.push({ step: 'finalize', label: '完成' });
    return steps;
  }

  /**
   * 按步骤列表执行安装流水线；任一步骤抛错或取消时标记任务终态并回收工作区。
   *
   * 每个非最终步骤完成后把当前 stage 目录整体复制给下一步，保证每步从干净快照开始；
   * 最终步骤把最后一份快照移动到目标路径。
   *
   * @param task - 待执行的任务记录（原地更新其状态）。
   */
  private async execute(task: TaskRecord): Promise<void> {
    const workspace = task.workspace;
    const steps = this.buildSteps(task.request);
    let stageDir = join(workspace, 'stage-0');
    task.status = 'running';

    try {
      await mkdir(stageDir, { recursive: true });
      for (let index = 0; index < steps.length; index += 1) {
        this.throwIfCancelled(task);
        const { step, label } = steps[index];
        task.currentStep = step;
        task.currentIndex = index;
        task.lastFraction = 0;
        this.emit(task, step, index, steps.length, 0, 'running', `开始${label}`);
        await this.runStep(task, stageDir, steps, index);
        this.emit(task, step, index, steps.length, 1, 'running', `${label}完成`);
        if (index < steps.length - 1) {
          const nextStage = join(workspace, `stage-${index + 1}`);
          this.emit(task, step, index, steps.length, 1, 'running', '正在复制目录供下一步使用...');
          await cp(stageDir, nextStage, { recursive: true, force: true });
          stageDir = nextStage;
        }
      }
      task.status = 'done';
      this.emit(task, 'finalize', steps.length - 1, steps.length, 1, 'done', '安装完成');
    } catch (error) {
      // 取消不是失败：执行器通过 AbortSignal 尽快停止，任务对外发布取消状态而非错误。
      if (task.controller.signal.aborted) {
        task.status = 'cancelled';
        this.emit(
          task,
          task.currentStep,
          task.currentIndex,
          steps.length,
          -1,
          'cancelled',
          '安装已取消',
        );
      } else {
        task.status = 'failed';
        task.failedStep = task.currentStep;
        this.emit(
          task,
          task.currentStep,
          task.currentIndex,
          steps.length,
          -1,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * 委托 `utils/install-tasks` 中的执行器完成单个任务，并装配共享上下文。
   *
   * @param task - 正在执行的任务记录。
   * @param stageDir - 当前步骤的工作目录快照。
   * @param steps - 完整步骤列表，用于计算步骤总数。
   * @param index - 当前步骤索引。
   */
  private async runStep(
    task: TaskRecord,
    stageDir: string,
    steps: TaskSpec[],
    index: number,
  ): Promise<void> {
    const { step, label } = steps[index];
    const stepCount = steps.length;
    const ctx: InstallTaskContext = {
      request: task.request,
      stageDir,
      mirrors: this.dependencies.mirrors.list(),
      signal: task.controller.signal,
      platform: task.request.platformId ? this.registry.get(task.request.platformId) : undefined,
      log: (message) =>
        this.emit(
          task,
          step,
          index,
          stepCount,
          task.lastFraction,
          'running',
          `[${label}] ${message}`,
        ),
      progress: (message, fraction) => {
        task.lastFraction = fraction;
        this.emit(task, step, index, stepCount, fraction, 'running', message);
      },
    };

    if (step === 'finalize') {
      await this.finalize(task, stageDir);
      return;
    }
    const executor = this.resolveExecutor(step);
    const result = await executor(ctx);
    if (
      step === 'install-platform' &&
      result &&
      typeof result === 'object' &&
      'version' in result
    ) {
      task.platformVersion = String((result as { version: string }).version);
    }
  }

  /**
   * 解析指定步骤的执行器；测试可经 `dependencies.executors` 覆盖，缺省返回真实执行器。
   *
   * `finalize` 属于编排服务自身逻辑，不支持覆盖。
   *
   * @param step - 当前步骤 ID。
   * @returns 接收安装任务上下文并返回结果的执行函数。
   */
  private resolveExecutor(step: InstallStepId): (ctx: InstallTaskContext) => Promise<unknown> {
    const override = this.dependencies.executors?.[step];
    if (override) return override;
    switch (step) {
      case 'install-mofox':
        return installMoFox;
      case 'install-platform':
        return installPlatform;
      case 'install-webui':
        return installWebUi;
      case 'configure':
        return configureInstance;
      case 'finalize':
        throw new MofoxError('INVALID_ARGUMENT', 'finalize 步骤由服务内部执行');
    }
  }

  /**
   * 将最后一份 stage 快照原子提交到目标路径，并在仓库中持久化新实例记录。
   *
   * 跨设备时回退为「复制后重命名」，保证目标目录仅在安装完整后可见。
   *
   * @param task - 正在执行收尾步骤的任务记录。
   * @param stageDir - 已配置完成的最终快照目录。
   * @throws {MofoxError} 目标不可访问时抛出对应错误。
   */
  private async finalize(task: TaskRecord, stageDir: string): Promise<void> {
    const target = resolve(task.request.targetDir);
    const staging = `${target}.neo-mofox-staging-${task.id}`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(resolve(target, '..'), { recursive: true });
    try {
      await rename(stageDir, staging);
      await rename(staging, target);
    } catch (error) {
      if (!isCrossDevice(error)) throw error;
      await cp(stageDir, staging, { recursive: true, force: true });
      await rename(staging, target);
      await rm(stageDir, { recursive: true, force: true });
    }
    await access(target, constants.F_OK);

    const platformId = task.request.platformId;
    await this.dependencies.repository.create({
      id: task.id,
      name: task.request.instanceName,
      mofoxInstallDir: join(target, 'mofox'),
      platform: platformId
        ? {
            id: platformId,
            installDir: join(target, 'platform'),
            version: task.platformVersion ?? null,
          }
        : { id: null, installDir: null, version: null },
    });
  }

  /**
   * 将当前任务进度作为完整事件载荷分发给渲染端。
   *
   * @param task - 来源任务记录。
   * @param step - 当前步骤 ID。
   * @param stepIndex - 当前步骤索引。
   * @param stepCount - 步骤总数。
   * @param progress - 当前步骤内 0..1 的进度；-1 表示不可测量。
   * @param status - 任务整体状态（running/failed/cancelled/done 等）。
   * @param message - 人类可读的进度文本。
   */
  private emit(
    task: TaskRecord,
    step: InstallStepId,
    stepIndex: number,
    stepCount: number,
    progress: number,
    status: InstallProgressEvent['status'],
    message: string,
  ): void {
    this.events.progress({
      taskId: task.id,
      instanceName: task.request.instanceName,
      step,
      stepIndex,
      stepCount,
      status,
      progress,
      message,
    });
  }

  /**
   * 检查任务取消信号，已取消时抛错以终止当前步骤。
   *
   * @param task - 待检查的任务记录。
   * @throws {MofoxError} 任务已被取消时抛出 `CONFLICT`。
   */
  private throwIfCancelled(task: TaskRecord): void {
    if (task.controller.signal.aborted) throw new MofoxError('CONFLICT', '安装已取消');
  }

  /**
   * 按 ID 查找任务，空 ID 或不存在时抛错。
   *
   * @param taskId - 待查找的任务 ID。
   * @returns 匹配的任务记录。
   * @throws {MofoxError} 空 ID 抛 `INVALID_ARGUMENT`；未找到抛 `NOT_FOUND`。
   */
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
 * @throws {MofoxError} 任一字段非法或目标路径非绝对路径时抛出 `INVALID_ARGUMENT`。
 */
function validateRequest(request: InstallRequest): void {
  const name = request.instanceName.trim();
  if (!name) throw new MofoxError('INVALID_ARGUMENT', '实例名称不能为空');
  if (name.length > 32) throw new MofoxError('INVALID_ARGUMENT', '实例名称不能超过 32 个字符');
  if (!/^\d{5,12}$/.test(request.botQQ.trim())) {
    throw new MofoxError('INVALID_ARGUMENT', 'Bot QQ 号格式错误');
  }
  if (!/^\d{5,12}$/.test(request.ownerQQ.trim())) {
    throw new MofoxError('INVALID_ARGUMENT', '主人 QQ 号格式错误');
  }
  if (!request.apiKey.trim()) throw new MofoxError('INVALID_ARGUMENT', 'API Key 不能为空');
  if (request.wsPort < 1024 || request.wsPort > 65535) {
    throw new MofoxError('INVALID_ARGUMENT', 'WebSocket 端口必须在 1024-65535 之间');
  }
  if (request.mofoxBranch !== 'main' && request.mofoxBranch !== 'dev') {
    throw new MofoxError('INVALID_ARGUMENT', 'MoFox 分支无效');
  }
  if (request.installWebui && request.webuiApiKey.length < 8) {
    throw new MofoxError('INVALID_ARGUMENT', 'WebUI 密钥至少需要 8 位');
  }
  if (!isAbsolute(request.targetDir)) {
    throw new MofoxError('INVALID_ARGUMENT', '安装目标路径必须是绝对路径');
  }
  if (resolve(request.targetDir) === resolve(request.targetDir, '..')) {
    throw new MofoxError('INVALID_ARGUMENT', '安装目标路径不能是文件系统根目录');
  }
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
