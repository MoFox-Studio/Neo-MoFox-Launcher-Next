/** 手动导入已有 Neo-MoFox 实例所需的用户输入。 */
export interface ManualImportRequest {
  /** 导入后在启动器中显示的实例名称。 */
  instanceName: string;
  /** 已存在的 Neo-MoFox 安装目录绝对路径。 */
  mofoxInstallDir: string;
  /** 已存在的平台适配器 ID；不配置平台时省略。 */
  platformId?: string;
  /** 与 platformId 对应的平台适配器目录；不配置平台时省略。 */
  platformDir?: string;
}

/** 手动导入成功后返回的实例标识。 */
export interface ManualImportResult {
  instanceId: string;
}

/** 路径探测结果：供输入目录时即时校验，不替代最终导入时的完整校验。 */
export interface PathInspection {
  /** 输入内容是否为绝对路径。 */
  absolute: boolean;
  /** 路径对应的文件系统条目是否存在。 */
  exists: boolean;
  /** 存在时是否为目录。 */
  isDirectory: boolean;
  /** 目录存在且为目录时，其中是否包含 main.py（Neo-MoFox 安装目录的标志）。 */
  mainPyExists: boolean;
}

/**
 * 平台安装目录探测结果：与 Neo-MoFox 的探测分离，按平台自身启动入口判定有效性。
 * 同样只用于导入前校验，不替代导入时对平台目录的再次检查。
 */
export interface PlatformPathInspection {
  /** 输入内容是否为绝对路径。 */
  absolute: boolean;
  /** 路径对应的文件系统条目是否存在。 */
  exists: boolean;
  /** 存在时是否为目录。 */
  isDirectory: boolean;
  /** 目录存在且为目录时，是否可从其中找到该平台的启动入口。 */
  valid: boolean;
}
