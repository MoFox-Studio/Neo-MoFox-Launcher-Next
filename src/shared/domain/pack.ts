/** 整合包（.mfpack）领域模型：与旧启动器一致的 manifest v2 + 可选内容段。 */

/** 整合包文件扩展名。 */
export const PACK_EXTENSION = '.mfpack';

/** manifest 格式版本；字段语义变更时必须递增并提供兼容处理。 */
export const MANIFEST_VERSION = 2;

/** manifest 固定文件名，位于压缩包根目录。 */
export const MANIFEST_FILENAME = 'manifest.json';

/** 平台上传信息：平台只能通过 ID 在导入时引用，不允许内置平台目录。 */
export interface PackPlatformContent {
  id?: string;
  installOnImport?: boolean;
  name?: string;
  version?: string;
}

/** 从实例目录枚举出的可选组件项（插件、插件配置等）。 */
export interface PackItemInfo {
  name: string;
  type: 'folder' | 'file';
}

/** 整合包 manifest：描述元信息、包含的内容段与平台引用。 */
export interface PackManifest {
  version: number;
  packName: string;
  packVersion: string;
  author: string;
  description: string;
  createdAt: string;
  launcherVersion?: string;
  content: {
    neoMofox: { included: boolean; version?: string; commit?: string };
    platform: PackPlatformContent;
    plugins: { included: boolean; list: string[] };
    config: { included: boolean };
    pluginConfigs?: { included: boolean; list?: string[] };
    data: { included: boolean };
  };
}

/** 导出整合包时用户选择的元数据与内容项。 */
export interface PackExportOptions {
  packName: string;
  packVersion: string;
  packAuthor: string;
  packDescription: string;
  includeMofox: boolean;
  includeConfig: boolean;
  includePlugins: boolean;
  selectedPlugins: string[];
  includePluginConfigs: boolean;
  selectedPluginConfigs: string[];
  includeData: boolean;
}

/** 整合包校验结果；errors 非空时视为不可导入。 */
export interface PackValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest: PackManifest | null;
}

/** 导入整合包所需的用户输入与目标位置。 */
export interface PackImportRequest {
  packPath: string;
  instanceName: string;
  targetDir: string;
}

/** 整合包导入/导出/校验产生的进度与日志事件。 */
export interface PackProgressEvent {
  taskId: string;
  percent: number;
  message: string;
}