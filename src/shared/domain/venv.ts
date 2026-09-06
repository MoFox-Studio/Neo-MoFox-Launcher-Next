/**
 * 虚拟环境（uv）路径探测结果：供输入 venv 目录时即时校验，不替代写入时的完整校验。
 */
export interface VenvPathInspection {
  /** 输入内容是否为绝对路径。 */
  absolute: boolean;
  /** 路径对应的文件系统条目是否存在。 */
  exists: boolean;
  /** 存在时是否为目录。 */
  isDirectory: boolean;
  /** 目录是否为有效 Python 虚拟环境（存在 `pyvenv.cfg`）。 */
  valid: boolean;
  /** 目录内是否有可用的 Python 解释器（`bin/python` 或 `Scripts/python.exe`）。 */
  pythonExists: boolean;
}

/** 已安装到虚拟环境中的单个包。 */
export interface VenvPackage {
  name: string;
  version: string;
}

/** 可升级的依赖项；`latest` 为可用最新版本。 */
export interface VenvUpgrade {
  name: string;
  current: string;
  latest: string;
}

/** 虚拟环境的包与可升级信息汇总。 */
export interface VenvInfo {
  /** 虚拟环境目录是否有效（存在且含 `pyvenv.cfg`）。 */
  valid: boolean;
  /** 环境内是否找到 Python 解释器。 */
  pythonExists: boolean;
  packages: VenvPackage[];
  /** 存在可升级依赖时为 `true`。 */
  hasUpgrades: boolean;
  upgrades: VenvUpgrade[];
}

/** 安装/卸载/更新单个包的结果。 */
export interface VenvPackageResult {
  name: string;
  version?: string;
  upgraded?: boolean;
  installed?: boolean;
  removed?: boolean;
  /** 操作是否成功。 */
  ok: boolean;
  /** 失败时的可读错误信息。 */
  message?: string;
}

/** 虚拟环境操作（升级依赖）向界面推送的进度事件。 */
export interface VenvProgressEvent {
  instanceId: string;
  /** 操作阶段标识。 */
  phase: 'install' | 'uninstall' | 'upgrade' | 'upgrade-all';
  /** 当前阶段内的 0..1 进度；无法测量时为 -1。 */
  percent: number;
  message: string;
  error?: string;
}
