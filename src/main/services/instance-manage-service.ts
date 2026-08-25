import type { Instance, UpdateInstancePatch } from '../../shared/domain/instance';
import { MofoxError } from '../../shared/domain/error';
import type { InstanceRuntimeService } from './instance-runtime-service';

/**
 * 实例管理服务：负责删除、打开安装目录与更新配置。
 *
 * 删除前先经运行服务优雅停机，再删除 MoFox 本体目录、持久化记录并清理运行时日志缓冲；
 * 打开目录则直接把 MoFox 本体安装目录交给系统文件管理器；更新配置直接委托仓库持久化。
 */
export class InstanceManageService {
  constructor(
    private readonly runtime: Pick<InstanceRuntimeService, 'stop' | 'clearLogs'>,
    private readonly repository: {
      list(): Promise<Instance[]>;
      remove(instanceId: string): Promise<void>;
      update(instanceId: string, patch: UpdateInstancePatch): Promise<Instance>;
    },
    private readonly removePath: (path: string) => Promise<void>,
    private readonly openPath: (path: string) => Promise<void>,
  ) {}

  /**
   * 删除实例：先经运行服务停止进程，再删除 MoFox 本体目录与持久化记录，并清理运行时日志缓冲。
   *
   * @param instanceId - 待删除的实例 ID。
   */
  async remove(instanceId: string): Promise<void> {
    // 先停机，再删除目录和记录，避免运行进程继续持有已删除路径。
    const instance = await this.find(instanceId);
    await this.runtime.stop(instanceId);
    await this.removePath(instance.mofoxInstallDir);
    await this.repository.remove(instanceId);
    this.runtime.clearLogs(instanceId);
  }

  /**
   * 在系统文件管理器中打开 MoFox 本体安装目录。
   *
   * @param instanceId - 实例 ID。
   */
  async openFolder(instanceId: string): Promise<void> {
    const instance = await this.find(instanceId);
    await this.openPath(instance.mofoxInstallDir);
  }

  /**
   * 更新实例的可编辑配置字段并返回持久化后的最新实例。
   *
   * @param instanceId - 实例 ID。
   * @param patch - 需要更新的字段；省略的字段保持原值。
   * @returns 更新后的实例记录。
   */
  async update(instanceId: string, patch: UpdateInstancePatch): Promise<Instance> {
    return this.repository.update(instanceId, patch);
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
    const instance = (await this.repository.list()).find((candidate) => candidate.id === instanceId);
    if (!instance) throw new MofoxError('NOT_FOUND', `未知实例: ${instanceId}`);
    return instance;
  }
}
