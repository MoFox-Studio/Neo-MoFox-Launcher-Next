import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { ZipArchive } from 'archiver';
import * as TOML from '@iarna/toml';
import type {
  Instance,
  PlatformPaths,
} from '../../shared/domain/instance';
import {
  MANIFEST_VERSION,
  PACK_EXTENSION,
  type PackExportOptions,
  type PackImportRequest,
  type PackItemInfo,
  type PackManifest,
  type PackValidationResult,
} from '../../shared/domain/pack';
import { MofoxError } from '../../shared/domain/error';
import { generateInstanceId } from '../utils/id-generator';
import { execCommand, unzip } from '../utils/platform-helper';

/**
 * 整合包服务：负责扫描实例组件、导出 .mfpack、校验与导入。
 *
 * 导出流程与旧启动器一致：临时目录汇集可选内容段（主程序/配置/插件/插件配置/数据），
 * 配置做脱敏处理，最终以 manifest v2 描述内容并压缩为 ZIP；
 * 平台不再写入整合包，导入时仅引用平台 ID（新版不下载平台）。
 * 导入流程：校验 ZIP 与 manifest → 解压 → 按目标目录注册实例 → 复制内容段。
 */
export interface PackServiceEvents {
  progress(event: { taskId: string; percent: number; message: string }): void;
}

interface Repository {
  list(): Promise<Instance[]>;
  upsert(instance: Instance): Promise<void>;
}

export class PackService {
  constructor(
    private readonly repository: Repository,
    private readonly events: PackServiceEvents,
  ) {}

  /**
   * 扫描实例的插件目录，返回插件名称与类型。
   *
   * @param instanceId - 实例 ID。
   * @returns 插件列表；目录不存在时返回空数组。
   */
  async scanInstancePlugins(instanceId: string): Promise<PackItemInfo[]> {
    const instance = await this.findInstance(instanceId);
    return this.scanDirectory(join(instance.mofoxInstallDir, 'plugins'));
  }

  /**
   * 扫描实例的插件配置目录。
   *
   * @param instanceId - 实例 ID。
   * @returns 插件配置列表；目录不存在时返回空数组。
   */
  async scanInstancePluginConfigs(instanceId: string): Promise<PackItemInfo[]> {
    const instance = await this.findInstance(instanceId);
    return this.scanDirectory(join(instance.mofoxInstallDir, 'config', 'plugins'));
  }

  /**
   * 导出指定实例为整合包。
   *
   * @param instanceId - 实例 ID。
   * @param options - 用户选择的元数据与内容段。
   * @param destPath - 导出的目标 .mfpack 文件路径。
   */
  async exportIntegrationPack(
    instanceId: string,
    options: PackExportOptions,
    destPath: string,
  ): Promise<void> {
    if (!destPath.trim()) throw new MofoxError('INVALID_ARGUMENT', '导出路径不能为空');
    const instance = await this.findInstance(instanceId);
    this.emit('初始化导出服务…', 1);

    const tempDir = join(tmpdir(), `mofox-export-${randomUUID()}`);
    try {
      await mkdir(tempDir, { recursive: true });

      this.emit('收集版本信息…', 5);
      const versionInfo = await this.collectVersionInfo(instance);

      // 1. 复制 Neo-MoFox 主程序（排除 data/config/plugins 与虚拟环境目录）。
      if (options.includeMofox) {
        this.emit('打包主程序文件…', 15);
        await this.copyMofox(instance.mofoxInstallDir, join(tempDir, 'neo-mofox'));
      }

      // 2. 平台不写入整合包，仅在 manifest 中记录平台 ID 引用。

      // 3. 复制额外文件（配置/插件/插件配置/数据）到 extra 目录。
      const exportedPlugins: string[] = [];
      if (
        options.includeConfig ||
        options.includePluginConfigs ||
        options.includePlugins ||
        options.includeData
      ) {
        this.emit('打包额外文件…', 35);
        exportedPlugins.push(
          ...(await this.copyExtraFiles(instance.mofoxInstallDir, tempDir, options)),
        );
      }

      // 4. 生成 manifest.json。
      this.emit('生成元数据…', 70);
      const manifest: PackManifest = this.createManifest(instance, options, exportedPlugins, versionInfo);
      await writeFile(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

      // 5. 压缩为 .mfpack。
      this.emit('压缩打包…', 75);
      await this.zipDirectory(tempDir, destPath);

      this.emit('导出完成', 100);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * 校验整合包文件：扩展名、ZIP 完整性、manifest 存在性与格式。
   *
   * @param packPath - .mfpack 文件路径。
   * @returns 校验结果与解析出的 manifest。
   */
  async validateIntegrationPack(packPath: string): Promise<PackValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    try {
      if (!packPath.trim()) throw new MofoxError('INVALID_ARGUMENT', '整合包路径不能为空');
      try {
        await access(packPath);
      } catch {
        throw new MofoxError('NOT_FOUND', `文件不存在: ${packPath}`);
      }
      if (!packPath.toLowerCase().endsWith(PACK_EXTENSION)) {
        throw new MofoxError('INVALID_ARGUMENT', `文件扩展名错误: 期望 ${PACK_EXTENSION}`);
      }

      const zip = new AdmZip(packPath);
      if (zip.getEntries().length === 0) throw new MofoxError('INVALID_ARGUMENT', '整合包为空');

      const manifestEntry = zip.getEntry('manifest.json');
      if (!manifestEntry) throw new MofoxError('INVALID_ARGUMENT', '整合包中缺少 manifest.json');

      let manifest: unknown;
      try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
      } catch (error) {
        throw new MofoxError(
          'INVALID_ARGUMENT',
          `manifest.json 格式错误: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const validation = this.validateManifest(manifest);
      errors.push(...validation.errors);
      warnings.push(...validation.warnings);
      return {
        valid: errors.length === 0,
        errors,
        warnings,
        manifest: errors.length === 0 ? (manifest as PackManifest) : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, errors: [...errors, message], warnings, manifest: null };
    }
  }

  /**
   * 导入整合包：校验、解压、按用户目标目录注册实例并复制内容段。
   *
   * @param request - 导入请求（包路径、实例名与目标根目录）。
   * @returns 导入使用的 manifest。
   */
  async importIntegrationPack(request: PackImportRequest): Promise<PackManifest> {
    const validation = await this.validateIntegrationPack(request.packPath);
    if (!validation.valid || !validation.manifest) {
      throw new MofoxError(
        'INVALID_ARGUMENT',
        `整合包验证失败: ${validation.errors.join('; ')}`,
      );
    }
    const manifest = validation.manifest;
    const tempDir = join(tmpdir(), `mofox-import-${randomUUID()}`);
    try {
      this.emit('解压整合包…', 5);
      await unzip(request.packPath, tempDir);

      const instanceId = generateInstanceId();
      const instanceRoot = join(request.targetDir, instanceId);
      await mkdir(instanceRoot, { recursive: true });

      // 1. 复制 Neo-MoFox 主程序。
      if (manifest.content.neoMofox.included) {
        this.emit('复制主程序文件…', 20);
        await this.copyDirectory(join(tempDir, 'neo-mofox'), join(instanceRoot, 'neo-mofox'));
      }

      const mofoxInstallDir = join(instanceRoot, 'neo-mofox');

      // 2. 复制额外内容（插件、插件配置、数据）。
      this.emit('复制插件与数据…', 45);
      if (manifest.content.plugins.included) {
        await this.copyDirectory(join(tempDir, 'extra', 'plugins'), join(mofoxInstallDir, 'plugins'));
      }
      if (manifest.content.pluginConfigs?.included) {
        await this.copyDirectory(
          join(tempDir, 'extra', 'plugin_configs'),
          join(mofoxInstallDir, 'config', 'plugins'),
        );
      }
      if (manifest.content.data.included) {
        await this.copyDirectory(join(tempDir, 'extra', 'data'), join(mofoxInstallDir, 'data'));
      }

      // 3. 配置脱敏占位符在导入时替换为默认值；无配置文件则跳过。
      if (manifest.content.config.included) {
        this.emit('处理配置文件…', 65);
        await this.processImportedConfig(join(tempDir, 'extra', 'config'), mofoxInstallDir);
      }

      // 4. 注册实例。
      const instance: Instance = {
        id: instanceId,
        name: request.instanceName.trim() || manifest.packName,
        version: manifest.content.neoMofox.version ?? 'unknown',
        mofoxInstallDir,
        platforms: this.resolvePlatformPaths(manifest),
        status: 'stopped',
        createdAt: Date.now(),
        autoStart: false,
      };
      await this.repository.upsert(instance);

      this.emit('导入完成', 100);
      return manifest;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ─── 私有工具方法 ─────────────────────────────────────────────────────

  private async findInstance(instanceId: string): Promise<Instance> {
    if (!instanceId.trim()) throw new MofoxError('INVALID_ARGUMENT', '实例 ID 不能为空');
    const instance = (await this.repository.list()).find((candidate) => candidate.id === instanceId);
    if (!instance) throw new MofoxError('NOT_FOUND', `实例不存在: ${instanceId}`);
    if (!instance.mofoxInstallDir.trim()) {
      throw new MofoxError('CONFLICT', `实例缺少 MoFox 目录: ${instanceId}`);
    }
    return instance;
  }

  private async scanDirectory(directory: string): Promise<PackItemInfo[]> {
    try {
      const items = await readdir(directory, { withFileTypes: true });
      return items.map((item) => ({
        name: item.name,
        type: item.isDirectory() ? ('folder' as const) : ('file' as const),
      }));
    } catch {
      return [];
    }
  }

  private async collectVersionInfo(instance: Instance): Promise<{ commit?: string }> {
    try {
      await access(join(instance.mofoxInstallDir, '.git'));
      const { stdout } = await execCommand('git', ['rev-parse', '--short=7', 'HEAD'], {
        cwd: instance.mofoxInstallDir,
        timeoutMs: 5000,
      });
      const commit = stdout.trim();
      return commit ? { commit } : {};
    } catch {
      return {};
    }
  }

  /**
   * 复制主程序目录，排除 data/config/plugins 与虚拟环境目录。
   */
  private async copyMofox(sourceDir: string, destDir: string): Promise<void> {
    const excluded = new Set(['data', 'config', 'plugins', '.venv', 'venv']);
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      const sourcePath = join(sourceDir, entry.name);
      const destPath = join(destDir, entry.name);
      try {
        if (entry.isDirectory()) await this.copyDirectory(sourcePath, destPath);
        else {
          await mkdir(dirname(destPath), { recursive: true });
          await this.copyFileSafe(sourcePath, destPath);
        }
      } catch (error) {
        this.warn(`复制失败，跳过 ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * 复制配置（脱敏）、插件配置、插件与数据到 extra 目录，返回实际复制的插件名。
   */
  private async copyExtraFiles(
    mofoxDir: string,
    tempDir: string,
    options: PackExportOptions,
  ): Promise<string[]> {
    const extraDir = join(tempDir, 'extra');
    await mkdir(extraDir, { recursive: true });
    const copiedPlugins: string[] = [];

    // 1. 配置文件 core.toml 脱敏：管理员 QQ 与 WebUI 密钥替换为占位符。
    if (options.includeConfig) {
      const coreTomlPath = join(mofoxDir, 'config', 'core.toml');
      try {
        const content = await readFile(coreTomlPath, 'utf8');
        const config = TOML.parse(content) as Record<string, unknown>;
        const sanitized = this.sanitizeConfig(config);
        await mkdir(join(extraDir, 'config'), { recursive: true });
        await writeFile(
          join(extraDir, 'config', 'core.toml'),
          TOML.stringify(sanitized as Parameters<typeof TOML.stringify>[0]),
          'utf8',
        );
      } catch (error) {
        this.warn(`配置脱敏失败，跳过: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 2. 插件配置复制到 extra/plugin_configs（与旧启动器布局一致）。
    if (options.includePluginConfigs && options.selectedPluginConfigs.length > 0) {
      const sourceDir = join(mofoxDir, 'config', 'plugins');
      const destDir = join(extraDir, 'plugin_configs');
      await mkdir(destDir, { recursive: true });
      for (const name of options.selectedPluginConfigs) {
        await this.copyItemSafe(join(sourceDir, name), join(destDir, name));
      }
    }

    // 3. 插件复制到 extra/plugins。
    if (options.includePlugins && options.selectedPlugins.length > 0) {
      const sourceDir = join(mofoxDir, 'plugins');
      const destDir = join(extraDir, 'plugins');
      await mkdir(destDir, { recursive: true });
      for (const name of options.selectedPlugins) {
        await this.copyItemSafe(join(sourceDir, name), join(destDir, name));
        copiedPlugins.push(name);
      }
    }

    // 4. 数据文件复制到 extra/data。
    if (options.includeData) {
      const sourceDir = join(mofoxDir, 'data');
      const destDir = join(extraDir, 'data');
      try {
        await access(sourceDir);
        await this.copyDirectory(sourceDir, destDir);
      } catch (error) {
        this.warn(`复制数据文件失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return copiedPlugins;
  }

  private sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = { ...config };
    const permissions = isRecord(result.permissions) ? { ...result.permissions } : undefined;
    if (permissions && Array.isArray(permissions.owner_list)) {
      permissions.owner_list = ['{{OWNER_QQ}}'];
      result.permissions = permissions;
    }
    const httpRouter = isRecord(result.http_router) ? { ...result.http_router } : undefined;
    if (httpRouter && Array.isArray(httpRouter.api_keys)) {
      httpRouter.api_keys = ['{{WEBUI_KEY}}'];
      result.http_router = httpRouter;
    }
    return result;
  }

  /**
   * 导入时把脱敏占位符替换为用户可接受的默认值。
   */
  private async processImportedConfig(sourceDir: string, mofoxDir: string): Promise<void> {
    const sourcePath = join(sourceDir, 'core.toml');
    try {
      const content = await readFile(sourcePath, 'utf8');
      const replaced = content
        .replaceAll('{{OWNER_QQ}}', '114514')
        .replaceAll('{{WEBUI_KEY}}', randomUUID());
      const destDir = join(mofoxDir, 'config');
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, 'core.toml'), replaced, 'utf8');
    } catch (error) {
      this.warn(`导入配置文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private resolvePlatformPaths(manifest: PackManifest): PlatformPaths {
    // 新版不在导入时下载平台；若 manifest 记录了平台 ID，此处保持空映射，
    // 由用户在路径配置页手动补全平台目录。
    void manifest;
    return {};
  }

  private createManifest(
    instance: Instance,
    options: PackExportOptions,
    exportedPlugins: string[],
    versionInfo: { commit?: string },
  ): PackManifest {
    const platformId = Object.keys(instance.platforms ?? {})[0] ?? '';
    return {
      version: MANIFEST_VERSION,
      packName: options.packName || instance.name,
      packVersion: options.packVersion || '1.0.0',
      author: options.packAuthor || 'Unknown',
      description: options.packDescription || `基于 ${instance.name} 实例的整合包`,
      createdAt: new Date().toISOString(),
      launcherVersion: 'next',
      content: {
        neoMofox: {
          included: options.includeMofox,
          ...(options.includeMofox ? { version: instance.version, ...versionInfo } : {}),
        },
        platform: { id: platformId || undefined, installOnImport: false },
        plugins: {
          included: options.includePlugins && exportedPlugins.length > 0,
          list: exportedPlugins,
        },
        config: { included: options.includeConfig },
        pluginConfigs: {
          included: options.includePluginConfigs,
          list: options.selectedPluginConfigs,
        },
        data: { included: options.includeData },
      },
    };
  }

  /**
   * 校验 manifest 结构；兼容旧启动器 v1 中 `napcat` 字段的迁移。
   */
  private validateManifest(value: unknown): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!isRecord(value)) return { errors: ['manifest 必须为对象'], warnings };
    if (value.version !== MANIFEST_VERSION) {
      errors.push(`不支持的 manifest 版本: ${String(value.version)}（当前支持 ${MANIFEST_VERSION}）`);
    }
    if (typeof value.packName !== 'string' || !value.packName.trim()) {
      errors.push('packName 必须为非空字符串');
    }
    const content = isRecord(value.content) ? value.content : {};
    for (const field of ['neoMofox', 'plugins', 'config', 'data'] as const) {
      const segment = content[field];
      if (!isRecord(segment) || typeof segment.included !== 'boolean') {
        errors.push(`content.${field}.included 必须为布尔值`);
      }
    }
    const platform = isRecord(content.platform) ? content.platform : {};
    if (platform.included === true) {
      errors.push('content.platform.included 已废弃，整合包不允许声明或内置平台');
    }
    if (platform.installOnImport === true && (typeof platform.id !== 'string' || !platform.id.trim())) {
      errors.push('content.platform.id 必须为非空字符串');
    }
    return { errors, warnings };
  }

  private async zipDirectory(sourceDir: string, outPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(outPath);
      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on('error', reject);
      output.on('close', resolve);
      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }

  private async copyItemSafe(sourcePath: string, destPath: string): Promise<void> {
    try {
      const info = await stat(sourcePath);
      await mkdir(dirname(destPath), { recursive: true });
      if (info.isDirectory()) await this.copyDirectory(sourcePath, destPath);
      else await this.copyFileSafe(sourcePath, destPath);
    } catch (error) {
      this.warn(`复制失败，跳过 ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async copyFileSafe(sourcePath: string, destPath: string): Promise<void> {
    await copyFile(sourcePath, destPath);
  }

  private async copyDirectory(sourceDir: string, destDir: string): Promise<void> {
    try {
      await access(sourceDir);
    } catch {
      return;
    }
    await mkdir(destDir, { recursive: true });
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '__pycache__' || entry.name === '.git' || entry.name === 'node_modules') {
        continue;
      }
      const sourcePath = join(sourceDir, entry.name);
      const destPath = join(destDir, entry.name);
      if (entry.isDirectory()) await this.copyDirectory(sourcePath, destPath);
      else await this.copyFileSafe(sourcePath, destPath);
    }
  }

  private emit(message: string, percent: number): void {
    const event = { taskId: `pack-${Date.now()}`, percent, message };
    this.events.progress(event);
  }

  private warn(message: string): void {
    this.events.progress({ taskId: `pack-${Date.now()}`, percent: -1, message: `警告: ${message}` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
