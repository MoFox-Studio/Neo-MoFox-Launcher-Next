import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  INSTANCES_VERSION,
  type Instance,
  type InstanceRepositoryFile,
  type InstalledPlatforms,
} from '../../shared/domain/instance';
import { MofoxError } from '../../shared/domain/error';
import { writeJsonAtomic } from '../utils/atomic-json';
import { upgradeInstancePathsToV2 } from '../utils/instance-migration';

/** 实例仓库负责把磁盘 JSON 规范化为领域记录，并通过串行原子写维持内存与持久化状态一致。 */
type DiagnosticReporter = (message: string, error: Error) => void;

/** 实例持久化结构的默认值；新增字段在无专用迁移时由此补齐。 */
export const DEFAULT_INSTANCE: Omit<Instance, 'id'> = {
  name: '',
  mofoxInstallDir: '',
  platforms: {},
  status: 'stopped',
  createdAt: 0,
  autoStart: false,
};

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
   * 新增或更新实例记录。
   *
   * 同 ID 存在则替换，否则追加。变更通过串行队列与原子写入持久化。
   *
   * @param instance - 待写入的实例对象。
   */
  async upsert(instance: Instance): Promise<void> {
    validateInstance(instance);
    await this.mutate((instances) => {
      const index = instances.findIndex((candidate) => candidate.id === instance.id);
      if (index >= 0) instances[index] = cloneInstance(instance);
      else instances.push(cloneInstance(instance));
    });
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
        instances
          .map((instance) => instance.mofoxInstallDir)
          .filter((value) => value.trim()),
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
      const canonical = file.version === INSTANCES_VERSION ? file : upgradeRepositoryFile(file);
      // 文件版本升级或结构偏离默认 schema 时立即回写，既补齐新增字段也移除已废弃字段。
      if (!isCanonicalRepositoryFile(parsed, canonical)) {
        await writeJsonAtomic(this.path, canonical).catch((error) => {
          this.report('Unable to persist normalized instance repository', toError(error));
        });
      }
      return canonical.instances;
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

/**
 * 将已规范化的实例集合标记为当前仓库版本。
 *
 * 字段兼容与迁移均在 `normalizeInstance()` 中完成：旧安装路径会拆为实例和平台目录，
 * 旧顶层平台版本会移入对应平台描述，已废弃的 MoFox 版本会被丢弃。
 */
function upgradeRepositoryFile(file: InstanceRepositoryFile): InstanceRepositoryFile {
  return { version: INSTANCES_VERSION, instances: file.instances.map(cloneInstance) };
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

/**
 * 从磁盘 JSON 中提取版本号；非法值回退为 1。
 *
 * @param value - 待提取的版本字段。
 * @returns 有限数字版本号，或 1。
 */
function extractVersion(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

/**
 * 规范化单条实例记录；导出供迁移器在预览阶段复用。
 * 历史字段（napcatDir、qqNickname、installPath、platformId 等）在此被收敛到当前 v4 schema。
 */
export function normalizeInstance(value: unknown): Instance {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Invalid instance: ID is required');
  }
  const extra = isRecord(value.extra) ? value.extra : {};
  const name = firstString(value.name, extra.displayName, value.qqNickname, value.id);
  // v1 installPath 同时承担 MoFox 本体与平台目录语义；优先采用 v2 字段，回退到 v1 字段。
  const legacyInstallPath = firstString(value.installPath, value.neomofoxDir, '');
  const mofoxInstallDir = firstString(value.mofoxInstallDir, legacyInstallPath);
  const legacyPlatformId = firstString(
    value.platformId,
    value.platform,
    value.platformDir || value.napcatDir ? 'napcat' : undefined,
    '',
  );
  // 兼容 v2/v3 的字符串平台路径，并将其收敛为当前平台描述对象。
  const inheritedPlatforms = normalizePlatforms(value.platforms);
  const legacyPlatformPath = firstString(value.platformRoot, value.platformDir, value.napcatDir);
  if (legacyPlatformId && legacyPlatformPath && !inheritedPlatforms[legacyPlatformId]) {
    inheritedPlatforms[legacyPlatformId] = { installDir: legacyPlatformPath };
  }
  const { platforms } = upgradeInstancePathsToV2({
    mofoxInstallDir,
    platforms: inheritedPlatforms,
    platformId: legacyPlatformId,
  });
  // v2 曾混用顶层 version：手动导入写入 MoFox 版本，平台安装写入平台版本。
  // 仅平台目录独立存在的记录可无歧义保留其安装器写入的平台版本。
  const isPlatformOnlyRecord = !firstString(value.mofoxInstallDir, value.neomofoxDir, value.installPath);
  const platformVersion = firstString(value.platformVersion);
  const napcatVersion = firstString(value.napcatVersion);
  const legacyPlatformVersion = firstString(
    platformVersion,
    napcatVersion,
    isPlatformOnlyRecord ? value.version : undefined,
  );
  setPlatformVersion(
    platforms,
    napcatVersion && !platformVersion ? 'napcat' : legacyPlatformId,
    legacyPlatformVersion,
  );
  const createdAt = normalizeTimestamp(value.createdAt);
  return {
    ...DEFAULT_INSTANCE,
    id: value.id,
    name,
    mofoxInstallDir,
    platforms,
    status: value.status === 'error' ? 'error' : 'stopped',
    createdAt,
    ...(typeof value.lastStartedAt === 'number' ? { lastStartedAt: value.lastStartedAt } : {}),
    autoStart: value.autoStart === true,
  };
}

/** 规范化旧路径字典与当前平台描述字典。 */
function normalizePlatforms(value: unknown): InstalledPlatforms {
  if (!isRecord(value)) return {};
  const platforms: InstalledPlatforms = {};
  for (const [id, rawPlatform] of Object.entries(value)) {
    if (!id.trim()) continue;
    if (typeof rawPlatform === 'string' && rawPlatform.trim()) {
      platforms[id] = { installDir: rawPlatform };
      continue;
    }
    if (!isRecord(rawPlatform)) continue;
    const installDir = firstString(rawPlatform.installDir);
    if (!installDir) continue;
    const version = firstString(rawPlatform.version);
    platforms[id] = { installDir, ...(version ? { version } : {}) };
  }
  return platforms;
}

/** 将遗留平台版本放入对应平台；缺少平台 ID 时仅在单平台记录中保留。 */
function setPlatformVersion(
  platforms: InstalledPlatforms,
  preferredPlatformId: string,
  version: string,
): void {
  if (!version) return;
  const platformId = platforms[preferredPlatformId]
    ? preferredPlatformId
    : Object.keys(platforms).length === 1
      ? Object.keys(platforms)[0]
      : '';
  const platform = platformId ? platforms[platformId] : undefined;
  if (platform && !platform.version) platforms[platformId] = { ...platform, version };
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
 * @throws {MofoxError} ID、名称或 MoFox 安装目录为空时抛出 `INVALID_ARGUMENT`。
 */
function validateInstance(instance: Instance): void {
  if (!instance.id.trim() || !instance.name.trim() || !instance.mofoxInstallDir.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Instance ID, name and mofoxInstallDir are required');
  }
}

/**
 * 从候选值列表中返回首个非空字符串，全部缺失时返回空串。
 *
 * @param values - 候选值数组。
 * @returns 首个非空白字符串，或空字符串。
 */
function firstString(...values: unknown[]): string {
  return (
    (values.find((value) => typeof value === 'string' && value.trim()) as string | undefined) ?? ''
  );
}

/**
 * 将任意输入归一化为有限时间戳。
 *
 * 接受数字（毫秒）或可解析的日期字符串；非法值回退为当前时间。
 *
 * @param value - 待归一化的时间戳。
 * @returns 毫秒级 Unix 时间戳。
 */
function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
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
