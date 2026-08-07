/** 手动添加实例的请求与结果领域模型。 */

/** 用户手动添加已有实例时填写的信息；平台项可选。 */
export interface ManualAddRequest {
  /** 实例显示名称；留空时由服务端根据 Git 信息或目录名生成。 */
  displayName?: string;
  /** MoFox 主程序安装目录；必填。 */
  mofoxInstallDir: string;
  /** 平台 ID（如 `napcat`、`snowluma`）；可选。 */
  platformId?: string;
  /** 平台适配器目录；可选，与 platformId 同时提供。 */
  platformDir?: string;
  /** 平台版本；可选。 */
  platformVersion?: string;
  /** 实例备注；可选。 */
  description?: string;
}

/** 手动添加实例的结果。 */
export interface ManualAddResult {
  success: boolean;
  instanceId?: string;
  /** 探测到的 MoFox 频道/分支；供界面提示。 */
  channel?: string;
  error?: string;
}