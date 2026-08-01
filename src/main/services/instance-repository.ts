import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  INSTANCES_VERSION,
  type Instance,
  type InstanceRepositoryFile,
} from '../../shared/domain/instance';
import { MofoxError } from '../../shared/domain/error';
import { writeJsonAtomic } from '../utils/atomic-json';

/** 实例仓库负责把磁盘 JSON 规范化为领域记录，并通过串行原子写维持内存与持久化状态一致。 */
type DiagnosticReporter = (message: string, error: Error) => void;

export class InstanceRepository {
  private readonly path: string;
  private instances?: Instance[];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    dataDirectory: string,
    private readonly report: DiagnosticReporter = (message, error) =>
      console.error(message, error),
  ) {
    this.path = join(dataDirectory, 'instances.json');
  }

  async list(): Promise<Instance[]> {
    if (!this.instances) this.instances = await this.load();
    return this.instances.map((instance) => ({ ...instance }));
  }

  async upsert(instance: Instance): Promise<void> {
    validateInstance(instance);
    await this.mutate((instances) => {
      const index = instances.findIndex((candidate) => candidate.id === instance.id);
      if (index >= 0) instances[index] = { ...instance };
      else instances.push({ ...instance });
    });
  }

  async remove(instanceId: string): Promise<void> {
    if (!instanceId.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
    await this.mutate((instances) => {
      const index = instances.findIndex((instance) => instance.id === instanceId);
      if (index >= 0) instances.splice(index, 1);
    });
  }

  /**
   * 批量合并外部迁移记录：同 ID 或同 installPath 视为冲突并跳过。
   * 调用方据此决定是否覆盖；返回实际写入的实例与被跳过的实例。
   */
  async mergeExternal(incoming: Instance[]): Promise<{ imported: Instance[]; skipped: Instance[] }> {
    const imported: Instance[] = [];
    const skipped: Instance[] = [];
    await this.mutate((instances) => {
      const byId = new Set(instances.map((instance) => instance.id));
      const byPath = new Set(instances.map((instance) => instance.installPath));
      for (const candidate of incoming) {
        try {
          validateInstance(candidate);
        } catch {
          skipped.push(candidate);
          continue;
        }
        if (byId.has(candidate.id) || byPath.has(candidate.installPath)) {
          skipped.push(candidate);
          continue;
        }
        byId.add(candidate.id);
        byPath.add(candidate.installPath);
        instances.push({ ...candidate });
        imported.push({ ...candidate });
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
      // 即时升级：磁盘版本落后于当前版本时，立即用迁移后的内容覆写文件，
      // 避免下次读取仍走迁移分支；不可读/未找到文件不触发写入。
      if (file.version !== INSTANCES_VERSION) {
        const upgraded = upgradeRepositoryFile(file);
        await writeJsonAtomic(this.path, upgraded).catch((error) => {
          this.report('Unable to persist upgraded instance repository', toError(error));
        });
        return upgraded.instances;
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
 * 把任意磁盘 JSON 规范化为仓库文件结构；单条记录异常不阻断其余实例恢复。
 * 导出供迁移器复用同一套字段映射逻辑；可选 reporter 收集坏记录诊断。
 */
export function normalizeRepositoryFile(
  value: unknown,
  report: (message: string, error: Error) => void = () => undefined,
): InstanceRepositoryFile {
  const records = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.instances)
      ? value.instances
      : [];
  const instances: Instance[] = [];
  for (const record of records) {
    try {
      instances.push(normalizeInstance(record));
    } catch (error) {
      report('Skipped invalid instance record', toError(error));
    }
  }
  return {
    version: extractVersion(isRecord(value) ? value.version : undefined),
    instances,
  };
}

/** 当前版本无需迁移；保留显式分支以承载未来字段升级。 */
function upgradeRepositoryFile(file: InstanceRepositoryFile): InstanceRepositoryFile {
  if (file.version === INSTANCES_VERSION) return file;
  // 版本 1 是初始版本，无需转换；更高版本到来时在此追加迁移分支。
  return { version: INSTANCES_VERSION, instances: file.instances.map((instance) => ({ ...instance })) };
}

function extractVersion(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

/**
 * 规范化单条实例记录；导出供迁移器在预览阶段复用。
 * 历史字段（napcatDir、qqNickname 等）在此被收敛到当前 schema。
 */
export function normalizeInstance(value: unknown): Instance {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Invalid instance: ID is required');
  }
  const extra = isRecord(value.extra) ? value.extra : {};
  const name = firstString(value.name, extra.displayName, value.qqNickname, value.id);
  const installPath = firstString(value.installPath, value.neomofoxDir, value.platformDir, value.napcatDir, '');
  const platformId = firstString(
    value.platformId,
    value.platform,
    value.platformDir || value.napcatDir ? 'napcat' : undefined,
    'unknown',
  );
  const createdAt = normalizeTimestamp(value.createdAt);
  return {
    id: value.id,
    name,
    version: firstString(value.version, value.neomofoxVersion, value.platformVersion, value.napcatVersion, 'unknown'),
    platformId,
    installPath,
    status: value.status === 'error' ? 'error' : 'stopped',
    createdAt,
    ...(typeof value.lastStartedAt === 'number' ? { lastStartedAt: value.lastStartedAt } : {}),
    autoStart: value.autoStart === true,
  };
}

function validateInstance(instance: Instance): void {
  if (!instance.id.trim() || !instance.name.trim() || !instance.installPath.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Instance ID, name and install path are required');
  }
}

function firstString(...values: unknown[]): string {
  return (values.find((value) => typeof value === 'string' && value.trim()) as string | undefined) ?? '';
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
