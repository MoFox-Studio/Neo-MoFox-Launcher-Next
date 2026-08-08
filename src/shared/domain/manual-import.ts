/** 手动导入已有 Neo-MoFox 实例所需的用户输入。 */
export interface ManualImportRequest {
  /** 导入后在启动器中显示的实例名称。 */
  instanceName: string;
  /** 已存在的 Neo-MoFox 安装目录绝对路径。 */
  mofoxInstallDir: string;
  /** 已知的 Neo-MoFox 版本；留空时由服务端标记为 unknown。 */
  version?: string;
  /** 已存在的平台适配器 ID；不配置平台时省略。 */
  platformId?: string;
  /** 与 platformId 对应的平台适配器目录；不配置平台时省略。 */
  platformDir?: string;
}

/** 手动导入成功后返回的实例标识。 */
export interface ManualImportResult {
  instanceId: string;
}
