import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LauncherSettings } from '../../shared/domain/instance';
import { MofoxError } from '../../shared/domain/error';
import { writeJsonAtomic } from '../utils/atomic-json';

/** 管理启动器设置的加载、旧字段兼容与原子持久化；内存快照仅在成功写入后同步。 */
export const DEFAULT_SETTINGS: LauncherSettings = {
  themeMode: 'system',
  seedColor: '#7C5CDB',
  language: 'zh-CN',
  defaultInstallDir: '',
  closeToTray: true,
  hardwareAcceleration: true,
  maxLogFileSizeMb: 16,
  maxLogArchiveDays: 14,
  compressLogArchive: true,
};

type DiagnosticReporter = (message: string, error: Error) => void;

const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

export class SettingsService {
  private readonly settingsPath: string;
  private readonly legacyPath: string;
  private settings?: LauncherSettings;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    dataDirectory: string,
    private readonly report: DiagnosticReporter = (message, error) => console.error(message, error),
  ) {
    this.settingsPath = join(dataDirectory, 'launcher-settings.json');
    this.legacyPath = join(dataDirectory, 'settings.json');
  }

  async get(): Promise<LauncherSettings> {
    if (!this.settings) this.settings = await this.load();
    return { ...this.settings };
  }

  async update(patch: unknown): Promise<LauncherSettings> {
    const validatedPatch = validateSettingsPatch(patch);
    let result = DEFAULT_SETTINGS;
    // 串行化读改写，避免并发 IPC 更新基于同一旧快照而相互覆盖。
    const operation = this.updateQueue.then(async () => {
      const current = await this.get();
      result = { ...current, ...validatedPatch };
      await writeJsonAtomic(this.settingsPath, result);
      this.settings = result;
    });
    this.updateQueue = operation.catch(() => undefined);
    await operation;
    return { ...result };
  }

  private async load(): Promise<LauncherSettings> {
    // 优先使用规范文件；首次迁移时仅读取旧文件，不在加载失败时破坏原始数据。
    const canonical = await this.read(this.settingsPath);
    if (canonical.found) return canonical.value ?? { ...DEFAULT_SETTINGS };
    const legacy = await this.read(this.legacyPath);
    return legacy.value ?? { ...DEFAULT_SETTINGS };
  }

  private async read(path: string): Promise<{ found: boolean; value?: LauncherSettings }> {
    try {
      const source = JSON.parse(await readFile(path, 'utf8')) as unknown;
      return { found: true, value: normalizeSettings(source) };
    } catch (error) {
      if (isFileNotFound(error)) return { found: false };
      const parsedError = error instanceof Error ? error : new Error(String(error));
      // 损坏或不可读配置降级为默认值，并将诊断交给应用日志而非中断启动。
      this.report(`Unable to read settings file ${path}`, parsedError);
      return { found: true };
    }
  }
}

export function validateSettingsPatch(patch: unknown): Partial<LauncherSettings> {
  /** IPC 边界仅接受已知字段与领域允许的值，防止任意 JSON 进入持久化文件。 */
  if (!isRecord(patch))
    throw new MofoxError('INVALID_ARGUMENT', 'Settings patch must be an object');
  for (const key of Object.keys(patch)) {
    if (!SETTING_KEYS.has(key))
      throw new MofoxError('INVALID_ARGUMENT', `Unknown settings field: ${key}`);
  }
  const normalized = normalizeSettings({ ...DEFAULT_SETTINGS, ...patch });
  for (const key of Object.keys(patch) as Array<keyof LauncherSettings>) {
    if (!isValidSettingValue(key, patch[key])) {
      throw new MofoxError('INVALID_ARGUMENT', `Invalid value for settings field: ${key}`);
    }
  }
  return Object.fromEntries(
    Object.keys(patch).map((key) => [key, normalized[key as keyof LauncherSettings]]),
  );
}

function normalizeSettings(source: unknown): LauncherSettings {
  if (!isRecord(source)) return { ...DEFAULT_SETTINGS };
  const logging = isRecord(source.logging) ? source.logging : {};
  const legacyMaxFileSize =
    typeof logging.maxFileSize === 'number' ? logging.maxFileSize / 1_048_576 : undefined;
  const candidate: Record<string, unknown> = {
    ...source,
    themeMode: source.themeMode ?? source.theme,
    seedColor: source.seedColor ?? source.accentColor,
    maxLogFileSizeMb: source.maxLogFileSizeMb ?? legacyMaxFileSize,
    maxLogArchiveDays: source.maxLogArchiveDays ?? logging.maxArchiveDays,
    compressLogArchive: source.compressLogArchive ?? logging.compressArchive,
  };
  const result = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof LauncherSettings>) {
    if (isValidSettingValue(key, candidate[key])) {
      (result as Record<string, unknown>)[key] = candidate[key];
    }
  }
  return result;
}

function isValidSettingValue(key: keyof LauncherSettings, value: unknown): boolean {
  switch (key) {
    case 'themeMode':
      return value === 'system' || value === 'light' || value === 'dark';
    case 'seedColor':
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    case 'language':
      return value === 'zh-CN' || value === 'en-US';
    case 'defaultInstallDir':
      return typeof value === 'string';
    case 'maxLogFileSizeMb':
      return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1024;
    case 'maxLogArchiveDays':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650;
    default:
      return typeof value === 'boolean';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
