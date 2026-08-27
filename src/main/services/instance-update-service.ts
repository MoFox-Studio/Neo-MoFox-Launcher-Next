import { access, cp, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Instance, UpdateInstancePatch } from '../../shared/domain/instance';
import type { BotPlatform, InstallContext } from '../../shared/domain/bot-platform';
import type { MirrorSource } from '../../shared/domain/mirror';
import type {
  MofoxUpdateInfo,
  PlatformUpdateInfo,
  UpdateProgressEvent,
} from '../../shared/domain/update';
import { MofoxError } from '../../shared/domain/error';
import {
  checkUpdateStatus,
  checkoutCommit,
  fetchRemoteBranches,
  getCommitList,
  getCurrentBranch,
  getCurrentCommit,
  isGitRepository,
  switchBranch,
  updateToLatest,
} from '../utils/git/git';
import { fetchReleases } from '../utils/git/github';

/**
 * 实例更新服务：管理主程序（Neo-MoFox）分支切换、提交回退与更新，
 * 以及平台适配器的版本切换。
 *
 * 平台更新采用缓存目录先行策略：先把现有安装目录移动到实例内的缓存目录，
 * 再把新版本安装进缓存并保留用户配置，全部成功后一次性拉回安装目录；
 * 任一环节失败则把缓存中的原版本还原到安装目录，保证安装目录始终可用。
 */
export class InstanceUpdateService {
  constructor(
    private readonly repository: {
      list(): Promise<Instance[]>;
      update(instanceId: string, patch: UpdateInstancePatch): Promise<Instance>;
    },
    private readonly registry: { get(platformId: string): BotPlatform },
    private readonly mirrors: { list(): MirrorSource[] },
    private readonly runtime: { stopSource(instanceId: string, source: 'platform'): Promise<void> },
    private readonly events: { progress(event: UpdateProgressEvent): void },
  ) {}

  /**
   * 获取主程序的版本与更新信息：当前分支、HEAD 提交、远程分支、提交历史与更新状态。
   *
   * @param instanceId - 实例 ID。
   * @returns 包含仓库状态、分支、提交与可更新标记的 MofoxUpdateInfo。
   */
  async getMofoxInfo(instanceId: string): Promise<MofoxUpdateInfo> {
    const instance = await this.find(instanceId);
    const directory = instance.mofoxInstallDir;
    const isRepository = await isGitRepository(directory);
    if (!isRepository) {
      return {
        isRepository: false,
        branch: null,
        currentCommit: null,
        branches: [],
        commits: [],
        hasUpdate: false,
        behindCount: 0,
        aheadCount: 0,
      };
    }
    const [branch, currentCommit, commits, updateStatus, branches] = await Promise.all([
      getCurrentBranch(directory),
      getCurrentCommit(directory),
      getCommitList(directory),
      checkUpdateStatus(directory),
      fetchRemoteBranches(this.mirrors.list()).catch(() => [] as string[]),
    ]);
    if (branch && !branches.includes(branch)) branches.unshift(branch);
    return {
      isRepository: true,
      branch,
      currentCommit,
      branches,
      commits,
      ...updateStatus,
    };
  }

  /**
   * 切换主程序到指定分支并拉取最新代码。
   *
   * @param instanceId - 实例 ID。
   * @param branch - 目标分支名。
   * @returns 切换完成后的最新版本信息。
   */
  async switchBranch(instanceId: string, branch: string): Promise<MofoxUpdateInfo> {
    const instance = await this.find(instanceId);
    await switchBranch(instance.mofoxInstallDir, branch, (message) =>
      this.emit(instanceId, 'switch-branch', -1, message),
    );
    return this.getMofoxInfo(instanceId);
  }

  /**
   * 回退主程序到指定提交并同步依赖。
   *
   * @param instanceId - 实例 ID。
   * @param commitHash - 目标提交的短哈希或完整哈希。
   * @returns 回退完成后的最新版本信息。
   */
  async checkoutCommit(instanceId: string, commitHash: string): Promise<MofoxUpdateInfo> {
    const instance = await this.find(instanceId);
    await checkoutCommit(instance.mofoxInstallDir, commitHash, (message) =>
      this.emit(instanceId, 'checkout-commit', -1, message),
    );
    return this.getMofoxInfo(instanceId);
  }

  /**
   * 更新主程序到当前分支的最新提交并同步依赖。
   *
   * @param instanceId - 实例 ID。
   * @returns 更新完成后的最新版本信息。
   */
  async updateMofox(instanceId: string): Promise<MofoxUpdateInfo> {
    const instance = await this.find(instanceId);
    await updateToLatest(instance.mofoxInstallDir, (message) =>
      this.emit(instanceId, 'update-mofox', -1, message),
    );
    return this.getMofoxInfo(instanceId);
  }

  /**
   * 获取平台适配器的版本与更新信息。
   *
   * @param instanceId - 实例 ID。
   * @returns 包含是否安装、当前版本与可用 Release 列表的 PlatformUpdateInfo。
   */
  async getPlatformInfo(instanceId: string): Promise<PlatformUpdateInfo> {
    const instance = await this.find(instanceId);
    if (!instance.platform?.id) {
      return { installed: false, currentVersion: null, releases: [] };
    }
    const platform = this.registry.get(instance.platform.id);
    const releases = await fetchReleases(this.mirrors.list(), platform.repository);
    return {
      installed: true,
      currentVersion: instance.platform.version,
      releases,
    };
  }

  /**
   * 更新平台适配器到指定版本（空字符串表示最新发行版）。
   *
   * 采用缓存目录先行策略：先停止平台进程并把现有安装目录移动到实例内缓存，
   * 再把新版本安装进缓存并保留用户配置目录，全部成功后一次性拉回安装目录；
   * 失败时还原缓存中的原版本，保证安装目录始终可用。
   *
   * @param instanceId - 实例 ID。
   * @param version - 目标版本 tag；空字符串表示最新发行版。
   * @returns 更新完成后的最新平台版本信息。
   * @throws {MofoxError} 实例未安装平台或更新失败时抛出。
   */
  async updatePlatform(instanceId: string, version: string): Promise<PlatformUpdateInfo> {
    const instance = await this.find(instanceId);
    if (!instance.platform?.id || !instance.platform.installDir) {
      throw new MofoxError('NOT_FOUND', '实例未安装平台');
    }
    const platform = this.registry.get(instance.platform.id);
    const installDir = instance.platform.installDir;
    const cacheDir = join(dirname(instance.mofoxInstallDir), '.update-cache');
    const backup = join(cacheDir, 'existing');

    this.emit(instanceId, 'update-platform', 0.02, '正在停止平台进程...');
    await this.runtime.stopSource(instanceId, 'platform');

    this.emit(instanceId, 'update-platform', 0.08, '正在把现有平台移动到缓存目录...');
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(cacheDir, { recursive: true });
    await movePath(installDir, backup);

    try {
      const target = version.trim() || 'latest';
      this.emit(
        instanceId,
        'update-platform',
        0.12,
        target === 'latest'
          ? `正在下载 ${platform.name} 最新版本...`
          : `正在下载 ${platform.name} ${target}...`,
      );
      const installContext: InstallContext = {
        instanceId,
        version: target,
        workDir: join(cacheDir, 'work'),
        targetDir: join(cacheDir, 'target'),
        mirrors: this.mirrors.list(),
      };
      const result = await platform.update(installContext);

      // 保留用户数据目录（如 NapCat/SnowLuma 的 config），避免更新后丢失 WS 配置。
      this.emit(instanceId, 'update-platform', 0.82, '正在保留用户配置...');
      await restoreUserData(backup, result.installPath, 'config');

      this.emit(instanceId, 'update-platform', 0.9, '正在把新版本安装回实例目录...');
      await rm(installDir, { recursive: true, force: true }).catch(() => undefined);
      await movePath(result.installPath, installDir);

      await this.repository.update(instanceId, {
        platform: { ...instance.platform, version: result.version },
      });
      this.emit(instanceId, 'update-platform', 1, '平台更新完成');
      return this.getPlatformInfo(instanceId);
    } catch (error) {
      this.emit(
        instanceId,
        'update-platform',
        -1,
        '更新失败，正在恢复原版本...',
        error instanceof Error ? error.message : String(error),
      );
      await rm(installDir, { recursive: true, force: true }).catch(() => undefined);
      if (await pathExists(backup)) await movePath(backup, installDir);
      throw error;
    } finally {
      await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
    }
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
   * 发布更新进度事件。
   *
   * @param instanceId - 实例 ID。
   * @param phase - 操作阶段标识。
   * @param percent - 当前阶段内 0..1 进度；-1 表示不可测量。
   * @param message - 人类可读进度文本。
   * @param error - 可选的失败原因。
   */
  private emit(
    instanceId: string,
    phase: string,
    percent: number,
    message: string,
    error?: string,
  ): void {
    this.events.progress({ instanceId, phase, percent, message, error });
  }
}

/**
 * 把源路径移动到目标路径；跨设备重命名失败时回退为复制后删除。
 *
 * @param source - 源路径。
 * @param target - 目标路径。
 * @throws {Error} 移动与复制均失败时抛出。
 */
async function movePath(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    if (!isCrossDevice(error)) throw error;
    await cp(source, target, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * 把备份目录中的用户数据目录恢复到新安装根目录，失败不中断流程。
 *
 * @param backup - 原版本备份目录。
 * @param newRoot - 新版本安装根目录。
 * @param relative - 需要保留的相对目录（如 `config`）。
 */
async function restoreUserData(backup: string, newRoot: string, relative: string): Promise<void> {
  const source = join(backup, relative);
  const target = join(newRoot, relative);
  if (!(await pathExists(source))) return;
  await rm(target, { recursive: true, force: true }).catch(() => undefined);
  await cp(source, target, { recursive: true });
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

/**
 * 判断路径是否存在且可访问。
 *
 * @param path - 待检查的路径。
 * @returns 路径存在时返回 `true`。
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
