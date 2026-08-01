import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Instance } from '../../shared/domain/instance';
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

  private async mutate(change: (instances: Instance[]) => void): Promise<void> {
    // 所有变更复用同一队列，避免安装、运行时状态更新等并发写丢失记录。
    const operation = this.writeQueue.then(async () => {
      const instances = await this.list();
      change(instances);
      await writeJsonAtomic(this.path, { version: 1, instances });
      this.instances = instances;
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private async load(): Promise<Instance[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      const records = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.instances)
          ? parsed.instances
          : [];
      const instances: Instance[] = [];
      for (const record of records) {
        try {
          instances.push(normalizeInstance(record));
        } catch (error) {
          // 单条历史记录异常不阻断其余实例恢复，诊断留给调用方日志系统。
          this.report('Skipped invalid instance record', toError(error));
        }
      }
      return instances;
    } catch (error) {
      // 文件不存在和损坏文件都以空集合恢复，且不在读取阶段覆盖用户原文件。
      if (!isRecord(error) || error.code !== 'ENOENT') {
        this.report(`Unable to read instance repository ${this.path}`, toError(error));
      }
      return [];
    }
  }
}

function normalizeInstance(value: unknown): Instance {
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
    version: firstString(value.version, value.platformVersion, value.napcatVersion, 'unknown'),
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
