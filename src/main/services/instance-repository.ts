import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  INSTANCES_VERSION,
  type CreateInstanceInput,
  type Instance,
  type InstanceRepositoryFile,
  type InstanceStatus,
  type InstalledPlatforms,
  type UpdateInstancePatch,
} from '../../shared/domain/instance';
import { MofoxError } from '../../shared/domain/error';
import { writeJsonAtomic } from '../utils/atomic-json';
import { generateInstanceId } from '../utils/id-generator';
import {
  DEFAULT_INSTANCE,
  normalizePlatforms,
  normalizeRepositoryFile,
} from '../utils/instance-migrations';

/** 实例仓库负责把磁盘 JSON 规范化为领域记录，并通过串行原子写维持内存与持久化状态一致。 */
type DiagnosticReporter = (message: string, error: Error) => void;

export class InstanceRepository {
  private readonly path: string;
  private instances?: Instance[];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    dataDirectory: string,
    private readonly report: DiagnosticReporter = (message, error) => console.error(message, error),
  ) {
    this.path = join(dataDirectory, 'instances.json');
  }

  /**
   * 列出全部实例，返回内存快照的浅拷贝。
   *
   * 首次调用会从磁盘加载并缓存；后续调用直接返回缓存。
   *
   * @returns 实例对象数组的浅拷贝。
   */
  async list(): Promise<Instance[]> {
    if (!this.instances) this.instances = await this.load();
    return this.instances.map(cloneInstance);
  }

  /**
   * 新增实例记录：由仓库在内部用默认值补齐完整结构后追加。
   *
   * 调用方只需提供业务字段；ID、状态、创建时间等由仓库构建。重复 ID 视为冲突并拒绝。
   *
   * @param input - 新增实例的业务字段。
   * @returns 已持久化的实例对象（浅拷贝）。
   * @throws {MofoxError} 名称为空或 ID 已存在时抛出 `INVALID_ARGUMENT`/`CONFLICT`。
   */
  async create(input: CreateInstanceInput): Promise<Instance> {
    const name = requireText(input.name, '实例名称不能为空');
    const instance = buildInstance({
      id: input.id?.trim() || generateInstanceId(),
      name,
      mofoxInstallDir: input.mofoxInstallDir?.trim() ?? '',
      platforms: normalizePlatforms(input.platforms),
      status: 'stopped',
      createdAt: Date.now(),
      autoStart: input.autoStart === true,
    });
    await this.mutate((instances) => {
      if (instances.some((candidate) => candidate.id === instance.id)) {
        throw new MofoxError('CONFLICT', `实例 ID 已存在: ${instance.id}`);
      }
      instances.push(cloneInstance(instance));
    });
    return cloneInstance(instance);
  }

  /**
   * 更新实例记录：加载现有记录后原地合并补丁，未提供的字段保持原值。
   *
   * 变更通过串行队列与原子写入持久化。
   *
   * @param instanceId - 待更新的实例 ID。
   * @param patch - 需要更新的字段；省略的字段保持不变。
   * @returns 更新后的实例对象（浅拷贝）。
   * @throws {MofoxError} ID 为空抛 `INVALID_ARGUMENT`；实例不存在抛 `NOT_FOUND`。
   */
  async update(instanceId: string, patch: UpdateInstancePatch): Promise<Instance> {
    requireId(instanceId);
    if (patch.name !== undefined && !patch.name.trim()) {
      throw new MofoxError('INVALID_ARGUMENT', '实例名称不能为空');
    }
    let updated: Instance | undefined;
    await this.mutate((instances) => {
      const index = instances.findIndex((candidate) => candidate.id === instanceId);
      if (index < 0) throw new MofoxError('NOT_FOUND', `未知实例: ${instanceId}`);
      const current = instances[index];
      updated = buildInstance({
        ...current,
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.mofoxInstallDir !== undefined
          ? { mofoxInstallDir: patch.mofoxInstallDir.trim() }
          : {}),
        ...(patch.platforms !== undefined
          ? { platforms: normalizePlatforms(patch.platforms) }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.lastStartedAt !== undefined ? { lastStartedAt: patch.lastStartedAt } : {}),
        ...(patch.autoStart !== undefined ? { autoStart: patch.autoStart } : {}),
      });
      instances[index] = cloneInstance(updated);
    });
    return cloneInstance(updated!);
  }

  /**
   * 按 ID 移除实例记录；ID 不存在时静默返回。
   *
   * @param instanceId - 待移除的实例 ID。
   * @throws {MofoxError} instanceId 为空时抛出 `INVALID_ARGUMENT`。
   */
  async remove(instanceId: string): Promise<void> {
    if (!instanceId.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
    await this.mutate((instances) => {
      const index = instances.findIndex((instance) => instance.id === instanceId);
      if (index >= 0) instances.splice(index, 1);
    });
  }

  /**
   * 批量合并外部迁移记录：同 ID 或同 mofoxInstallDir 视为冲突并跳过。
   * 调用方据此决定是否覆盖；返回实际写入的实例与被跳过的实例。
   */
  async mergeExternal(
    incoming: Instance[],
  ): Promise<{ imported: Instance[]; skipped: Instance[] }> {
    const imported: Instance[] = [];
    const skipped: Instance[] = [];
    await this.mutate((instances) => {
      const byId = new Set(instances.map((instance) => instance.id));
      const byPath = new Set(
        instances.map((instance) => instance.mofoxInstallDir).filter((value) => value.trim()),
      );
      for (const candidate of incoming) {
        try {
          validateInstance(candidate);
        } catch {
          skipped.push(candidate);
          continue;
        }
        if (byId.has(candidate.id) || byPath.has(candidate.mofoxInstallDir)) {
          skipped.push(candidate);
          continue;
        }
        byId.add(candidate.id);
        byPath.add(candidate.mofoxInstallDir);
        instances.push(cloneInstance(candidate));
        imported.push(cloneInstance(candidate));
      }
    });
    return { imported, skipped };
  }

  private async mutate(change: (instances: Instance[]) => void): Promise<void> {
    // 所有变更复用同一队列，避免安装、运行时状态更新等并发写丢失记录。
    const operation = this.writeQueue.then(async () => {
      const instances = await this.list();
      change(instances);
      await writeJsonAtomic(this.path, { version: INSTANCES_VERSION, instances });
      this.instances = instances;
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private async load(): Promise<Instance[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      const file = normalizeRepositoryFile(parsed, this.report);
      // 版本升级或结构偏离默认 schema 时立即回写，既补齐新增字段也移除已废弃字段。
      if (!isCanonicalRepositoryFile(parsed, file)) {
        await writeJsonAtomic(this.path, file).catch((error) => {
          this.report('Unable to persist normalized instance repository', toError(error));
        });
      }
      return file.instances;
    } catch (error) {
      // 文件不存在和损坏文件都以空集合恢复，且不在读取阶段覆盖用户原文件。
      if (!isRecord(error) || error.code !== 'ENOENT') {
        this.report(`Unable to read instance repository ${this.path}`, toError(error));
      }
      return [];
    }
  }
}

/**
 * 在内部构建完整的实例记录：以默认结构为基底，用调用方提供的字段覆盖。
 *
 * 调用方无需拼装完整 JSON，缺失字段一律落到 {@link DEFAULT_INSTANCE} 的默认值。
 *
 * @param seed - 部分字段；ID 必填，其余可选。
 * @returns 覆盖了全部字段的 {@link Instance}。
 */
function buildInstance(seed: {
  id: string;
  name?: string;
  mofoxInstallDir?: string;
  platforms?: InstalledPlatforms;
  status?: InstanceStatus;
  createdAt?: number;
  lastStartedAt?: number | null;
  autoStart?: boolean;
}): Instance {
  return { ...DEFAULT_INSTANCE, ...seed };
}

/** 判断磁盘原始值是否已完全符合当前仓库与实例结构，避免无变化时重复写入。 */
function isCanonicalRepositoryFile(value: unknown, file: InstanceRepositoryFile): boolean {
  if (!isRecord(value) || value.version !== INSTANCES_VERSION || !Array.isArray(value.instances)) {
    return false;
  }
  return (
    value.instances.length === file.instances.length &&
    value.instances.every((instance, index) =>
      isCanonicalInstance(instance, file.instances[index]),
    ) &&
    Object.keys(value).length === 2
  );
}

/** 仅接受键和值均与规范化实例一致的记录，额外或缺失字段都会触发回写。 */
function isCanonicalInstance(value: unknown, instance: Instance | undefined): boolean {
  return Boolean(instance && isRecord(value) && JSON.stringify(value) === JSON.stringify(instance));
}

/** 复制平台字典和平台描述，避免调用方修改返回值后污染仓库缓存。 */
function cloneInstance(instance: Instance): Instance {
  const platforms: InstalledPlatforms = {};
  for (const [id, platform] of Object.entries(instance.platforms)) {
    platforms[id] = { ...platform };
  }
  return { ...instance, platforms };
}

/**
 * 校验实例记录的关键字段是否非空。
 *
 * @param instance - 待校验的实例对象。
 * @throws {MofoxError} ID 或名称为空时抛出 `INVALID_ARGUMENT`。
 */
function validateInstance(instance: Instance): void {
  if (!instance.id.trim() || !instance.name.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Instance ID and name are required');
  }
}

/** 校验实例 ID 字符串并返回，空值抛出 `INVALID_ARGUMENT`。 */
function requireId(value: string): string {
  if (!value.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
  return value;
}

/** 校验必填文本在进入持久化层前已经去除首尾空白。 */
function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new MofoxError('INVALID_ARGUMENT', message);
  return trimmed;
}

/**
 * 判断值是否为普通对象（非数组、非 null）。
 *
 * @param value - 待判断的值。
 * @returns 值为 Record 时返回 `true`。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 将任意值转换为 Error 实例，便于诊断报告统一处理。
 *
 * @param value - 待转换的值。
 * @returns Error 实例。
 */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
