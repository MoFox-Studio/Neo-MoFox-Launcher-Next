import type { Instance } from './instance';

// ─── 旧启动器迁移 ────────────────────────────────────────────────────────

/**
 * 旧启动器在数据目录存放 `instances.json`，字段命名与当前规范不同。
 * 仅声明迁移所需字段；迁移器据此把遗留记录归一化为 {@link Instance}。
 */
export interface LegacyInstanceRecord {
  id: string;
  name?: string;
  qqNickname?: string;
  qqNumber?: string;
  neomofoxDir?: string;
  platformRoot?: string;
  platformDir?: string;
  napcatDir?: string;
  platform?: string;
  platformVersion?: string;
  napcatVersion?: string;
  version?: string;
  neomofoxVersion?: string;
  installCompleted?: boolean;
  status?: string;
  createdAt?: unknown;
  lastStartedAt?: unknown;
  autoStart?: boolean;
  extra?: {
    displayName?: string;
    description?: string;
    isLike?: boolean;
    iconPath?: string;
  };
  [key: string]: unknown;
}

/** 旧启动器数据目录的探测结果。 */
export interface LegacyLauncherInfo {
  /** 旧启动器数据目录的绝对路径。 */
  dataDirectory: string;
  /** 旧 instances.json 中识别到的实例数量。 */
  instanceCount: number;
  /** instances.json 的最后修改时间；缺失时为 null。 */
  modifiedAt: number | null;
}

/** 单条旧实例的迁移预览，含规范化结果与冲突标记。 */
export interface LegacyInstancePreview {
  /** 规范化后的实例；导入成功后写入新仓库。 */
  instance: Instance;
  /** 与新仓库中同 ID 实例的冲突描述；无冲突时为 null。 */
  conflict: 'duplicate-id' | 'duplicate-path' | null;
  /** 解析实例名所用的来源字段，便于调试与展示。 */
  nameSource: 'name' | 'extra.displayName' | 'qqNickname' | 'id';
}

/** 迁移预览：旧启动器信息 + 每条记录的规范化与冲突结果。 */
export interface MigrationPreview {
  legacy: LegacyLauncherInfo;
  previews: LegacyInstancePreview[];
}

/** 导入操作的汇总结果。 */
export interface MigrationResult {
  /** 实际写入新仓库的实例数量（跳过冲突项后）。 */
  imported: number;
  /** 因 ID 或路径冲突而跳过的实例数量。 */
  skipped: number;
  /** 导入后新仓库中的实例总数。 */
  total: number;
}
