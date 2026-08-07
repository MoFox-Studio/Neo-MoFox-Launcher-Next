import { readFile, stat } from 'node:fs/promises';

import { type Instance } from '../../shared/domain/instance';
import {
  type LegacyInstancePreview,
  type LegacyLauncherInfo,
  type MigrationPreview,
  type MigrationResult,
} from '../../shared/domain/migration';
import { MofoxError } from '../../shared/domain/error';
import { normalizeInstance } from './instance-repository';

/** 旧启动器数据目录的默认解析入口；调用方注入平台相关的基础路径。 */
export interface LegacyDataDirResolution {
  /** Electron `app.getPath('appData')` 或其等价目录；旧启动器在此目录下创建 `Neo-MoFox-Launcher` 子目录。 */
  appDataDir: string;
  /** 允许调用方覆盖默认路径（例如环境变量或命令行参数）。 */
  override?: string;
}

/**
 * 计算旧启动器默认数据目录。
 * 旧启动器在 `<appData>/Neo-MoFox-Launcher/` 下存放 instances.json，
 * 与 Electron `app.setName('Neo-MoFox-Launcher')` 的 userData 解析结果一致。
 */
export function resolveLegacyLauncherDataDir(resolution: LegacyDataDirResolution): string {
  if (resolution.override && resolution.override.trim()) return resolution.override;
  const separator = resolution.appDataDir.includes('\\') ? '\\' : '/';
  return resolution.appDataDir.endsWith(separator)
    ? `${resolution.appDataDir}Neo-MoFox-Launcher`
    : `${resolution.appDataDir}${separator}Neo-MoFox-Launcher`;
}

type DiagnosticReporter = (message: string, error: Error) => void;

/** 拼接旧数据路径，同时保留测试或迁移中的 Windows 分隔符。 */
function joinLegacyPath(directory: string, file: string): string {
  const separator = directory.includes('\\') ? '\\' : '/';
  return directory.endsWith(separator) ? `${directory}${file}` : `${directory}${separator}${file}`;
}

/**
 * 旧启动器到新启动器的实例迁移服务。
 * 仅读取旧数据目录的 instances.json，归一化后并入新仓库；不修改旧目录任何文件。
 */
export class LegacyMigrationService {
  /**
   * @param legacyDataDirectory - 旧启动器数据目录的绝对路径。
   * @param repository - 新实例仓库，提供列表与批量合并接口。
   * @param report - 可选诊断回调；默认输出至 `console.warn`。
   */
  constructor(
    private readonly legacyDataDirectory: string,
    private readonly repository: {
      list(): Promise<Instance[]>;
      upsert(instance: Instance): Promise<void>;
      mergeExternal(incoming: Instance[]): Promise<{ imported: Instance[]; skipped: Instance[] }>;
    },
    private readonly report: DiagnosticReporter = (message, error) => console.warn(message, error),
  ) {}

  /** 探测旧启动器数据目录是否存在 instances.json，并返回其摘要。 */
  async detect(): Promise<LegacyLauncherInfo | null> {
    const instancesFile = joinLegacyPath(this.legacyDataDirectory, 'instances.json');
    try {
      const fileStat = await stat(instancesFile);
      const records = await this.readRawRecords(instancesFile);
      return {
        dataDirectory: this.legacyDataDirectory,
        instanceCount: records.length,
        modifiedAt: Number.isFinite(fileStat.mtimeMs) ? fileStat.mtimeMs : null,
      };
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') {
        this.report(`Unable to detect legacy launcher at ${instancesFile}`, toError(error));
      }
      return null;
    }
  }

  /** 读取旧 instances.json 并对每条记录生成规范化预览与冲突标记。 */
  async preview(): Promise<MigrationPreview> {
    const info = await this.detect();
    if (!info) {
      throw new MofoxError('NOT_FOUND', `未在 ${this.legacyDataDirectory} 找到旧启动器数据`);
    }
    const records = await this.readRawRecords(joinLegacyPath(this.legacyDataDirectory, 'instances.json'));
    const existing = await this.repository.list();
    const existingIds = new Set(existing.map((instance) => instance.id));
    const existingPaths = new Set(
      existing.map((instance) => instance.mofoxInstallDir).filter((value) => value.trim()),
    );

    const previews: LegacyInstancePreview[] = [];
    for (const record of records) {
      // 保留原始记录以反推 nameSource；规范化失败时仅跳过当前记录。
      try {
        const instance = normalizeInstance(record);
        previews.push({
          instance,
          conflict: detectConflict(instance, existingIds, existingPaths),
          nameSource: resolveNameSource(record),
          platformPathSource: resolvePlatformPathSource(record),
        });
      } catch (error) {
        this.report('Skipped invalid legacy instance record', toError(error));
      }
    }
    return { legacy: info, previews };
  }

  /**
   * 启动期修复已迁移实例的平台路径，不导入旧启动器中尚未存在的新实例。
   * 旧数据不存在时静默返回，避免把首次安装场景当作错误。
   */
  async repairExistingInstances(): Promise<number> {
    const info = await this.detect();
    if (!info) return 0;
    const preview = await this.preview();
    return (await this.repairMatchingInstances(preview)).repaired;
  }

  /**
   * 执行迁移：导入新实例，并修复此前因旧迁移规则写入错误平台路径的同一实例。
   * 同 ID 且 MoFox 目录一致时只同步平台路径，保留新版实例的名称、状态与其他设置。
   */
  async importInstances(): Promise<MigrationResult> {
    const preview = await this.preview();
    const { repaired, repairedIds } = await this.repairMatchingInstances(preview);

    const incoming = preview.previews
      .filter((entry) => entry.conflict === null)
      .map((entry) => entry.instance);
    const merge = await this.repository.mergeExternal(incoming);
    const total = await this.repository.list();
    return {
      // 对用户而言修复既有迁移记录与首次导入均属于成功接管旧配置。
      imported: merge.imported.length + repaired,
      skipped:
        preview.previews.filter(
          (entry) => entry.conflict !== null && !repairedIds.has(entry.instance.id),
        ).length + merge.skipped.length,
      total: total.length,
    };
  }

  /** 只修复能以同 ID、同 MoFox 目录确认身份，且旧记录包含明确平台路径的实例。 */
  private async repairMatchingInstances(
    preview: MigrationPreview,
  ): Promise<{ repaired: number; repairedIds: Set<string> }> {
    const existing = await this.repository.list();
    const existingById = new Map(existing.map((instance) => [instance.id, instance]));
    let repaired = 0;
    const repairedIds = new Set<string>();

    for (const entry of preview.previews) {
      if (entry.conflict !== 'duplicate-id' || entry.platformPathSource !== 'explicit') continue;
      const current = existingById.get(entry.instance.id);
      if (!current || !sameInstallPath(current.mofoxInstallDir, entry.instance.mofoxInstallDir)) {
        continue;
      }
      const platforms = { ...current.platforms, ...entry.instance.platforms };
      if (samePlatformPaths(current.platforms, platforms)) continue;
      await this.repository.upsert({ ...current, platforms });
      repaired += 1;
      repairedIds.add(entry.instance.id);
    }

    return { repaired, repairedIds };
  }

  /** 读取旧 instances.json 中的原始记录数组；兼容裸数组和带 version 的对象两种布局。 */
  private async readRawRecords(path: string): Promise<unknown[]> {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (Array.isArray(parsed)) return parsed;
    if (isRecord(parsed) && Array.isArray(parsed.instances)) return parsed.instances;
    return [];
  }
}

/** 判断旧记录是否包含可安全接管的平台实际运行根目录。 */
function resolvePlatformPathSource(record: unknown): LegacyInstancePreview['platformPathSource'] {
  if (!isRecord(record)) return 'inferred';
  return typeof record.platformRoot === 'string' && record.platformRoot.trim()
    ? 'explicit'
    : typeof record.platformDir === 'string' && record.platformDir.trim()
      ? 'explicit'
      : typeof record.napcatDir === 'string' && record.napcatDir.trim()
        ? 'explicit'
        : 'inferred';
}

/** 比较安装路径；Windows 路径忽略分隔符、尾分隔符与大小写差异。 */
function sameInstallPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/+$/, '');
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  const isWindowsPath = /^[a-z]:\//i.test(normalizedLeft) || /^[a-z]:\//i.test(normalizedRight);
  return isWindowsPath
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

/** 比较两个平台路径字典，避免无变化时重复写入仓库。 */
function samePlatformPaths(left: Instance['platforms'], right: Instance['platforms']): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([platformId, path]) => right[platformId] === path)
  );
}

/**
 * 检测旧实例与已有实例之间的 ID/路径冲突类型。
 *
 * @param instance - 待导入的旧实例。
 * @param existingIds - 已存在实例的 ID 集合。
 * @param existingPaths - 已存在实例的安装路径集合。
 * @returns `duplicate-id`、`duplicate-path` 或 `null`（无冲突）。
 */
function detectConflict(
  instance: Instance,
  existingIds: Set<string>,
  existingPaths: Set<string>,
): LegacyInstancePreview['conflict'] {
  if (existingIds.has(instance.id)) return 'duplicate-id';
  if (instance.mofoxInstallDir.trim() && existingPaths.has(instance.mofoxInstallDir)) {
    return 'duplicate-path';
  }
  return null;
}

/** 反推实例名所用的源字段；仅用于 UI 展示，缺失时回退到 'id'。 */
function resolveNameSource(record: unknown): LegacyInstancePreview['nameSource'] {
  if (!isRecord(record)) return 'id';
  if (typeof record.name === 'string' && record.name.trim()) return 'name';
  const extra = isRecord(record.extra) ? record.extra : {};
  if (typeof extra.displayName === 'string' && extra.displayName.trim()) {
    return 'extra.displayName';
  }
  if (typeof record.qqNickname === 'string' && record.qqNickname.trim()) {
    return 'qqNickname';
  }
  return 'id';
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
