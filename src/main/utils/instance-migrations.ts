import { MofoxError } from '../../shared/domain/error';
import {
  INSTANCES_VERSION,
  type Instance,
  type InstanceRepositoryFile,
  type InstalledPlatform,
} from '../../shared/domain/instance';

// ─── 实例结构迁移 ─────────────────────────────────────────────────────────
//
// 磁盘上的 instances.json 带有一个递增的 version 字段。每次结构变更都必须递增
// {@link INSTANCES_VERSION}，并在 {@link MIGRATIONS} 中登记一段「从当前版本迁移到
// 下一版本」的分支。旧版本文件在加载时按 1 → 2 → 3 → … 顺序逐级迁移，因此某个版本
// 对应的迁移分支只需要关心该版本引入的字段差异，而无需感知更早或更晚的结构。
//
// 迁移完成后还会对每条记录执行 {@link normalizeInstance} 兜底：补齐当前 schema 的
// 默认值、收敛仍残留的历史字段别名、剔除未知字段。这样即使「当前版本」文件被手工
// 改动或来自更早版本的未迁移快照，也能安全恢复，且幂等（已规范的记录不会再被改写）。

/** 实例持久化结构的默认值；新增字段在无专用迁移时由此补齐，保证覆盖 `Instance` 的全部字段。 */
export const DEFAULT_INSTANCE: Required<Omit<Instance, 'id'>> = {
  name: '',
  mofoxInstallDir: '',
  platform: { id: null, installDir: null, version: null },
  status: 'stopped',
  createdAt: 0,
  lastStartedAt: null,
  autoStart: false,
};

/** 版本迁移分支的入参/出参：携带版本号的实例记录集合（迁移期间记录仍是未经规范化的原始形状）。 */
interface VersionedFile {
  version: number;
  instances: unknown[];
}

/**
 * 版本 → 下一版本迁移分支的注册表。
 *
 * 键是迁移的起点版本号，值为把 `N` 版记录转换为 `N+1` 版记录的迁移函数。
 * 新增结构变更时必须同时递增 {@link INSTANCES_VERSION} 并在末尾追加一段 `N → N+1` 迁移。
 */
const MIGRATIONS: Readonly<Record<number, (file: VersionedFile) => VersionedFile>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
  3: migrateV3ToV4,
  4: migrateV4ToV5,
  5: migrateV5ToV6,
  6: migrateV6ToV7,
};

/**
 * 把 `instances.json` 解析值规范化为当前版本的仓库结构。
 *
 * 兼容裸数组与 `{ version, instances }` 两种布局；逐条记录执行版本迁移与兜底规范化，
 * 单条坏记录由 reporter 收集诊断后跳过，不阻断其余实例恢复。
 *
 * @param value - 磁盘 JSON 的解析结果。
 * @param report - 坏记录诊断回调；默认静默丢弃。
 * @returns 版本已升至 {@link INSTANCES_VERSION} 的规范化仓库结构。
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
  const upgraded = upgradeInstances(
    extractVersion(isRecord(value) ? value.version : undefined),
    records,
  );
  const instances: Instance[] = [];
  for (const record of upgraded.instances) {
    try {
      instances.push(normalizeInstance(record));
    } catch (error) {
      report('Skipped invalid instance record', toError(error));
    }
  }
  return { version: INSTANCES_VERSION, instances };
}

/**
 * 按版本号从起点到 {@link INSTANCES_VERSION} 逐级执行迁移分支。
 *
 * 例如 `version: 1` 的文件会依次经过 1→2、2→3、3→4、4→5、5→6、6→7；缺失迁移分支
 * （版本已超出当前版本）时立即停止，剩余字段收敛交给 {@link normalizeInstance} 兜底。
 *
 * @param version - 文件记录的起始版本号。
 * @param instances - 起始版本的实例记录集合。
 * @returns 迁移后的版本号与记录集合。
 */
function upgradeInstances(
  version: number,
  instances: unknown[],
): { version: number; instances: unknown[] } {
  let current: VersionedFile = { version, instances };
  while (current.version < INSTANCES_VERSION) {
    const migrate = MIGRATIONS[current.version];
    if (!migrate) break;
    current = migrate(current);
  }
  return current;
}

/**
 * 规范化单条实例记录；把历史字段（installPath、platformId、platforms 字典、napcatDir、
 * qqNickname 等）收敛到当前 v6 schema，并补齐默认值、剔除未知字段。
 *
 * 既是版本迁移的最终兜底，也被旧启动器迁移器在预览阶段直接复用。
 *
 * @param value - 未经类型约束的单条实例记录。
 * @returns 完全符合当前 schema 的 {@link Instance}。
 * @throws {MofoxError} 记录缺少非空 `id` 时抛出 `INVALID_ARGUMENT`。
 */
export function normalizeInstance(value: unknown): Instance {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) {
    throw new MofoxError('INVALID_ARGUMENT', 'Invalid instance: ID is required');
  }
  const extra = isRecord(value.extra) ? value.extra : {};
  const name = firstString(value.name, extra.displayName, value.qqNickname, value.id);
  // v1 installPath 同时承担 MoFox 本体与平台目录语义；优先采用 v2 字段，回退到 v1 字段。
  const mofoxInstallDir = firstString(value.mofoxInstallDir, value.installPath, value.neomofoxDir);
  const createdAt = normalizeTimestamp(value.createdAt);
  return {
    ...DEFAULT_INSTANCE,
    id: value.id,
    name,
    mofoxInstallDir,
    platform: resolvePlatform(value),
    status: value.status === 'error' ? 'error' : 'stopped',
    createdAt,
    lastStartedAt: typeof value.lastStartedAt === 'number' ? value.lastStartedAt : null,
    autoStart: value.autoStart === true,
  };
}

// ─── 版本迁移分支 ────────────────────────────────────────────────────────

/**
 * v1 → v2：把单一 `installPath` + `platformId` 字段拆分为 `mofoxInstallDir` +
 * 平铺的 `platform` 对象，并沿用兄弟目录启发式把平台路径烘焙为显式值。
 */
function migrateV1ToV2(file: VersionedFile): VersionedFile {
  const instances = file.instances.map((record) => {
    const value = asRecord(record);
    const upgraded = upgradeInstancePathsToV2({
      mofoxInstallDir: firstString(value.mofoxInstallDir),
      installPath: firstString(value.installPath, value.neomofoxDir) || undefined,
      platforms: value.platforms,
      platformId: firstString(
        value.platformId,
        value.platform,
        value.platformDir || value.napcatDir ? 'napcat' : undefined,
      ),
    });
    for (const field of LEGACY_PATH_FIELDS) delete value[field];
    return {
      ...value,
      mofoxInstallDir: upgraded.mofoxInstallDir,
      platform: upgraded.platform,
    };
  });
  return { version: 2, instances };
}

/** v1 时代承载安装路径与平台路径的字段；迁移后必须整体移除。 */
const LEGACY_PATH_FIELDS = [
  'installPath',
  'neomofoxDir',
  'platformId',
  'platform',
  'platformRoot',
  'platformDir',
  'napcatDir',
] as const;

/**
 * v2 → v3：v2 混用了顶层 `version`（手动导入写 MoFox 版本，平台安装写平台版本）。
 * 记录包含 MoFox 目录时视为 MoFox 版本并丢弃；仅平台目录独立存在时视为平台版本，
 * 写入平铺的 `platform.version` 后丢弃顶层字段。
 */
function migrateV2ToV3(file: VersionedFile): VersionedFile {
  const instances = file.instances.map((record) => {
    const value = asRecord(record);
    const version = firstString(value.version);
    if (version) {
      // resolvePlatform 会自行判断 version 是 MoFox 版本还是平台版本（仅平台记录采纳）。
      value.platform = resolvePlatform(value);
      delete value.version;
    }
    return value;
  });
  return { version: 3, instances };
}

/**
 * v3 → v4：把顶层的 `platformVersion` / `napcatVersion` 收进平铺的 `platform.version`。
 */
function migrateV3ToV4(file: VersionedFile): VersionedFile {
  const instances = file.instances.map((record) => {
    const value = asRecord(record);
    const platformVersion = firstString(value.platformVersion);
    const napcatVersion = firstString(value.napcatVersion);
    if (platformVersion || napcatVersion) {
      // resolvePlatform 已把 platformVersion/napcatVersion 并入 version。
      value.platform = resolvePlatform(value);
    }
    for (const field of ['platformVersion', 'napcatVersion'] as const) delete value[field];
    return value;
  });
  return { version: 4, instances };
}

/** v4 → v5：把可选的 `lastStartedAt` 补齐为必填字段，从未启动过的记录显式写入 `null`。 */
function migrateV4ToV5(file: VersionedFile): VersionedFile {
  const instances = file.instances.map((record) => {
    const value = asRecord(record);
    if (typeof value.lastStartedAt !== 'number') value.lastStartedAt = null;
    return value;
  });
  return { version: 5, instances };
}

/**
 * v5 → v6：把 `platforms` 字典（ID → { installDir, version }）平铺为单个
 * `platform` 对象（{ id, installDir, version }），字典中的首个条目作为唯一平台。
 */
function migrateV5ToV6(file: VersionedFile): VersionedFile {
  const instances = file.instances.map((record) => {
    const value = asRecord(record);
    value.platform = resolvePlatform(value);
    delete value.platforms;
    return value;
  });
  return { version: 6, instances };
}

/**
 * v6 → v7：`platform` 不再整体为 `null`，而是始终是 `{ id, installDir, version }`
 * 对象；未安装平台的记录补成三个字段全为 `null`，并确保 `version` 字段始终存在。
 */
function migrateV6ToV7(file: VersionedFile): VersionedFile {
  const instances = file.instances.map((record) => {
    const value = asRecord(record);
    value.platform = resolvePlatform(value);
    return value;
  });
  return { version: 7, instances };
}

// ─── Legacy instance path migration ───────────────────────────────────────

/**
 * 把 v1 实例记录（仍含 `installPath` + `platformId` 单字段）升级为当前结构。
 *
 * v1 的 `installPath` 同时承担 MoFox 本体目录与平台目录两重语义，运行时通过
 * `dirname(installPath)/<platformId>` 兄弟目录回退来定位平台。当前结构把二者拆开：
 * `mofoxInstallDir` 指向 MoFox 本体，`platform` 平铺记录平台 ID、安装目录与版本。
 * 迁移时沿用旧的兄弟目录启发式，把平台路径烘焙为显式值，旧实例无需重新配置即可启动。
 *
 * 路径分隔符同时兼容 `/` 与 `\`：迁移可能在 Linux 主进程上解析旧 Windows 实例记录，
 * `node:path` 的 `dirname`/`join` 在 POSIX 平台只识别 `/`，会把 `D:\Bots\1` 当作无分隔符，
 * 因此这里用自实现的、同时识别两种分隔符的 `parentDir`/`joinPath`。
 *
 * @param record - v1 实例记录（至少包含 `installPath` 与 `platformId`）。
 * @returns 当前结构的 `mofoxInstallDir` 与平铺的 `platform`；输入缺字段时给出安全默认值。
 */
export function upgradeInstancePathsToV2(record: {
  installPath?: string;
  mofoxInstallDir?: string;
  platforms?: unknown;
  platformId?: string;
}): { mofoxInstallDir: string; platform: InstalledPlatform } {
  const mofoxInstallDir = record.mofoxInstallDir || record.installPath || '';
  const platformId = record.platformId ?? '';
  let platform = flattenPlatformsDict(record.platforms);
  if (!platform && platformId) {
    // v1 靠 dirname(installPath)/<platformId> 兄弟目录回退定位平台；当前结构把它烘焙为显式路径。
    const installDir = mofoxInstallDir ? joinPath(parentDir(mofoxInstallDir), platformId) : '';
    if (installDir) platform = { id: platformId, installDir, version: null };
  }
  return { mofoxInstallDir, platform: toCompletePlatform(platform) };
}

// ─── 平台解析 ─────────────────────────────────────────────────────────────

/**
 * 从任意版本的记录中解析出平铺的单个平台对象；任何来源都缺失时返回全 `null` 的平台。
 *
 * 来源按优先级合并：v6 平铺的 `platform` → v5 的 `platforms` 字典（取首个条目）→
 * 遗留的顶层 `platformId`/`platform`/`platformDir`/`napcatDir`/`platformRoot` →
 * v1 兄弟目录启发式；版本则合并 `platformVersion`/`napcatVersion` 以及仅平台记录的顶层
 * `version`。缺失的字段统一落为 `null`。
 *
 * @param value - 未经类型约束的单条实例记录。
 * @returns 字段完整（可能含 `null`）的平台对象。
 */
function resolvePlatform(value: Record<string, unknown>): InstalledPlatform {
  const mofoxInstallDir = firstString(value.mofoxInstallDir, value.installPath, value.neomofoxDir);
  const flat = normalizePlatformValue(value.platform);
  const inherited = flattenPlatformsDict(value.platforms);
  const legacyPlatformId = firstString(
    value.platformId,
    value.platform,
    value.platformDir || value.napcatDir ? 'napcat' : undefined,
    '',
  );
  const legacyPlatformPath = firstString(value.platformRoot, value.platformDir, value.napcatDir);
  const isPlatformOnlyRecord = !mofoxInstallDir;
  const platformVersion = firstString(value.platformVersion);
  const napcatVersion = firstString(value.napcatVersion);
  const legacyPlatformVersion = firstString(
    platformVersion,
    napcatVersion,
    isPlatformOnlyRecord ? value.version : undefined,
  );

  const preferredId = napcatVersion && !platformVersion ? 'napcat' : legacyPlatformId;
  const id = flat?.id || inherited?.id || preferredId || '';
  let installDir = flat?.installDir || inherited?.installDir || legacyPlatformPath || '';
  let version = flat?.version || inherited?.version || legacyPlatformVersion || '';

  if (!installDir && id && mofoxInstallDir) {
    // v1 靠 dirname(mofoxInstallDir)/<id> 兄弟目录回退定位平台；当前结构把它烘焙为显式路径。
    installDir = joinPath(parentDir(mofoxInstallDir), id);
  }
  return toCompletePlatform({ id, installDir, version });
}

/**
 * 把部分平台字段补齐为完整的 {@link InstalledPlatform}：空字符串一律落为 `null`。
 *
 * @param platform - 可能缺字段的平台对象。
 * @returns 三个字段齐全的平台对象。
 */
function toCompletePlatform(
  platform: {
    id: string | null;
    installDir: string | null;
    version: string | null;
  } | null,
): InstalledPlatform {
  return {
    id: platform?.id || null,
    installDir: platform?.installDir || null,
    version: platform?.version || null,
  };
}

/**
 * 规范化平铺平台对象：从 `{ id, installDir, version }`（或 v2-v5 字典中的单条描述）中
 * 提取字段，缺失或空字符串一律落为 `null`。
 *
 * @param value - 平台对象或字典条目。
 * @returns 三个字段齐全的平台对象。
 */
export function normalizePlatformValue(value: unknown): InstalledPlatform {
  if (!isRecord(value)) return { id: null, installDir: null, version: null };
  return toCompletePlatform({
    id: firstString(value.id),
    installDir: firstString(value.installDir),
    version: firstString(value.version),
  });
}

/**
 * 把 v2-v5 的 `platforms` 字典平铺为单个平台对象，取首个非空条目作为唯一平台。
 * 兼容字符串路径与 `{ installDir, version }` 描述对象两种写法。
 *
 * @param value - `platforms` 字典。
 * @returns 首个有效条目的平铺平台对象，或 `null`。
 */
function flattenPlatformsDict(value: unknown): InstalledPlatform | null {
  if (!isRecord(value)) return null;
  for (const [id, raw] of Object.entries(value)) {
    if (!id.trim()) continue;
    if (typeof raw === 'string' && raw.trim()) {
      return { id, installDir: raw, version: null };
    }
    if (!isRecord(raw)) continue;
    const installDir = firstString(raw.installDir);
    if (!installDir) continue;
    return toCompletePlatform({ id, installDir, version: firstString(raw.version) });
  }
  return null;
}

// ─── 路径辅助（仅迁移期使用） ─────────────────────────────────────────────

/**
 * 取路径的父目录；同时兼容 `/` 与 `\` 分隔符，仅在迁移期使用。
 *
 * @param path - 待解析的路径。
 * @returns 父目录字符串；无分隔符时返回空串。
 */
function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : '';
}

/**
 * 极简跨平台路径拼接；仅在迁移期使用。
 *
 * @param parent - 父目录。
 * @param child - 子路径片段。
 * @returns 以 `/` 或 `\` 拼接的字符串；输入为空时返回另一侧。
 */
function joinPath(parent: string, child: string): string {
  if (!parent) return child;
  if (!child) return parent;
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.endsWith(sep) ? `${parent}${child}` : `${parent}${sep}${child}`;
}

// ─── 规范化辅助 ───────────────────────────────────────────────────────────

/** 把任意输入视为可变普通对象；非对象时返回空对象，保证迁移分支不会因坏记录抛错。 */
function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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
