import type { InstalledPlatforms } from '../../shared/domain/instance';

// ─── Legacy instance path migration ───────────────────────────────────────

/**
 * 把 v1 实例记录（仍含 `installPath` + `platformId` 单字段）升级为当前结构。
 *
 * v1 的 `installPath` 同时承担 MoFox 本体目录与平台目录两重语义，运行时通过
 * `dirname(installPath)/<platformId>` 兄弟目录回退来定位平台。当前结构把二者拆开：
 * `mofoxInstallDir` 指向 MoFox 本体，`platforms[platformId]` 显式记录平台安装信息。
 * 迁移时沿用旧的兄弟目录启发式，把平台路径烘焙为显式值，旧实例无需重新配置即可启动。
 *
 * 路径分隔符同时兼容 `/` 与 `\`：迁移可能在 Linux 主进程上解析旧 Windows 实例记录，
 * `node:path` 的 `dirname`/`join` 在 POSIX 平台只识别 `/`，会把 `D:\Bots\1` 当作无分隔符，
 * 因此这里用自实现的、同时识别两种分隔符的 `parentDir`/`joinPath`。
 *
 * @param record - v1 实例记录（至少包含 `installPath` 与 `platformId`）。
 * @returns 当前结构的 `mofoxInstallDir` 与 `platforms` 字段；输入缺字段时给出安全默认值。
 */
export function upgradeInstancePathsToV2(record: {
  installPath?: string;
  mofoxInstallDir?: string;
  platforms?: InstalledPlatforms;
  platformId?: string;
}): { mofoxInstallDir: string; platforms: InstalledPlatforms } {
  const mofoxInstallDir = record.mofoxInstallDir ?? record.installPath ?? '';
  const platformId = record.platformId ?? '';
  const platforms: InstalledPlatforms = {};
  for (const [id, platform] of Object.entries(record.platforms ?? {})) {
    platforms[id] = { ...platform };
  }
  if (platformId && !platforms[platformId] && mofoxInstallDir) {
    // v1 靠 dirname(installPath)/<platformId> 兄弟目录回退定位平台；当前结构把它烘焙为显式路径。
    platforms[platformId] = { installDir: joinPath(parentDir(mofoxInstallDir), platformId) };
  }
  return { mofoxInstallDir, platforms };
}

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
