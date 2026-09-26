import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_WALLPAPER_BLUR,
  DEFAULT_WALLPAPER_DIM,
  DEFAULT_WALLPAPER_OPACITY,
  type LauncherSettings,
} from '../../shared/domain/settings';
import {
  DEFAULT_HOME_SETTINGS,
  isHomeSettingsShape,
  normalizeHomeSettings,
} from '../../shared/domain/home';
import { MofoxError } from '../../shared/domain/error';
import { writeJsonAtomic } from '../utils/atomic-json';

/** 管理启动器设置的加载、旧字段兼容与原子持久化；内存快照仅在成功写入后同步。 */
export const DEFAULT_SETTINGS: LauncherSettings = {
  themeMode: 'system',
  themeColorSource: 'manual',
  seedColor: '#367BF0',
  wallpaperSeedColor: '',
  paletteStyle: 'tonal-spot',
  themeContrast: 'standard',
  appearanceDensity: 'comfortable',
  motionPreference: 'system',
  systemBackdrop: true,
  navigationPosition: 'side',
  navigationStyle: 'standard',
  language: 'zh-CN',
  defaultInstallDir: '',
  closeToTray: true,
  trayNotifications: true,
  autoCheckUpdates: true,
  hardwareAcceleration: true,
  maxLogFileSizeMb: 16,
  maxLogArchiveDays: 14,
  compressLogArchive: true,
  wallpaperType: 'none',
  wallpaperFileName: '',
  wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
  wallpaperDim: DEFAULT_WALLPAPER_DIM,
  wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
  oobeCompleted: false,
  home: normalizeHomeSettings(DEFAULT_HOME_SETTINGS),
};

type DiagnosticReporter = (message: string, error: Error) => void;

const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

export class SettingsService {
  private readonly settingsPath: string;
  private readonly legacyPath: string;
  private settings?: LauncherSettings;
  private loading?: Promise<LauncherSettings>;
  private updateQueue: Promise<void> = Promise.resolve();
  private writeBlockedReason?: Error;

  /**
   * @param dataDirectory - 启动器数据目录的绝对路径。
   * @param report - 可选诊断回调；默认输出至 `console.error`。
   */
  constructor(
    dataDirectory: string,
    private readonly report: DiagnosticReporter = (message, error) => console.error(message, error),
  ) {
    this.settingsPath = join(dataDirectory, 'launcher-settings.json');
    this.legacyPath = join(dataDirectory, 'settings.json');
  }

  /** 规范设置源文件（launcher-settings.json）的绝对路径，供「打开源文件」等能力使用。 */
  get filePath(): string {
    return this.settingsPath;
  }

  /**
   * 获取当前设置；首次调用从磁盘加载并缓存。
   *
   * @returns 设置对象的浅拷贝。
   */
  async get(): Promise<LauncherSettings> {
    if (!this.settings) this.settings = await (this.loading ??= this.load());
    return { ...this.settings };
  }

  /**
   * 应用部分字段更新并原子持久化。
   *
   * 串行化读改写以避免并发 IPC 更新基于同一旧快照相互覆盖。
   *
   * @param patch - 待合并的字段对象。
   * @returns 合并后的完整设置对象（拷贝）。
   */
  async update(patch: unknown): Promise<LauncherSettings> {
    const validatedPatch = validateSettingsPatch(patch);
    let result = DEFAULT_SETTINGS;
    // 串行化读改写，避免并发 IPC 更新基于同一旧快照而相互覆盖。
    const operation = this.updateQueue.then(async () => {
      const current = await this.get();
      if (this.writeBlockedReason) {
        throw new MofoxError(
          'UNAVAILABLE',
          `设置文件处于只读保护状态：${this.writeBlockedReason.message}`,
        );
      }
      result = { ...current, ...validatedPatch };
      await writeJsonAtomic(this.settingsPath, result);
      this.settings = result;
    });
    this.updateQueue = operation.catch(() => undefined);
    await operation;
    return { ...result };
  }

  /**
   * 从磁盘加载设置，优先使用规范文件路径，缺失时回退至旧文件名。
   *
   * @returns 字段完整的设置对象；读取失败时返回默认值。
   */
  private async load(): Promise<LauncherSettings> {
    // 优先使用规范文件；首次迁移时仅读取旧文件，不在加载失败时破坏原始数据。
    const canonical = await this.read(this.settingsPath);
    if (canonical.found) return canonical.value ?? { ...DEFAULT_SETTINGS };
    const legacy = await this.read(this.legacyPath);
    return legacy.value ?? { ...DEFAULT_SETTINGS };
  }

  /**
   * 读取单个设置文件并归一化为完整设置对象。
   * 文件不存在时返回 `{ found: false }`。
   *
   * @param path - 设置文件路径。
   * @returns 含 `found` 标记与可选值的对象。
   */
  private async read(path: string): Promise<{ found: boolean; value?: LauncherSettings }> {
    try {
      const source = JSON.parse(await readFile(path, 'utf8')) as unknown;
      if (!isRecord(source)) throw new MofoxError('INVALID_ARGUMENT', '设置文件顶层结构无效');
      return { found: true, value: normalizeSettings(source) };
    } catch (error) {
      if (isFileNotFound(error)) return { found: false };
      const parsedError = error instanceof Error ? error : new Error(String(error));
      // 损坏或不可读配置降级为默认值，并将诊断交给应用日志而非中断启动。
      this.report(`Unable to read settings file ${path}`, parsedError);
      await copyFile(path, `${path}.corrupt.${Date.now()}`).catch(() => undefined);
      const recovered = await this.readBackup(path);
      if (recovered) return { found: true, value: recovered };
      this.writeBlockedReason = parsedError;
      return { found: true };
    }
  }

  private async readBackup(path: string): Promise<LauncherSettings | undefined> {
    const backupPath = `${path}.bak`;
    try {
      const source = JSON.parse(await readFile(backupPath, 'utf8')) as unknown;
      if (!isRecord(source)) return undefined;
      const recovered = normalizeSettings(source);
      await copyFile(backupPath, path);
      this.report('Recovered settings from backup', new Error(backupPath));
      return recovered;
    } catch {
      return undefined;
    }
  }
}

/**
 * 校验并归一化设置补丁。
 *
 * IPC 边界仅接受已知字段与领域允许的值，防止任意 JSON 进入持久化文件。
 *
 * @param patch - 待校验的设置补丁对象。
 * @returns 已归一化的部分字段对象。
 * @throws {MofoxError} 补丁非对象、含未知字段或字段值非法时抛出 `INVALID_ARGUMENT`。
 */
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

/**
 * 将任意来源数据归一化为完整的 LauncherSettings。
 *
 * 兼容旧字段（theme、accentColor、logging.*）并合并默认值；非法字段被静默丢弃。
 *
 * @param source - 待归一化的原始数据。
 * @returns 字段完整的设置对象。
 */
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
    // 主页布局为嵌套结构，统一走深度归一化以补齐缺失部件并丢弃未知条目。
    if (key === 'home') continue;
    if (isValidSettingValue(key, candidate[key])) {
      (result as Record<string, unknown>)[key] = candidate[key];
    }
  }
  (result as Record<string, unknown>).home = normalizeHomeSettings(candidate.home);
  return result;
}

/**
 * 校验单个设置字段是否为合法值。
 *
 * @param key - 设置字段名。
 * @param value - 待校验的值。
 * @returns 字段值合法时返回 `true`。
 */
function isValidSettingValue(key: keyof LauncherSettings, value: unknown): boolean {
  switch (key) {
    case 'themeMode':
      return value === 'system' || value === 'light' || value === 'dark';
    case 'themeColorSource':
      return value === 'manual' || value === 'wallpaper' || value === 'system';
    case 'seedColor':
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    case 'wallpaperSeedColor':
      return typeof value === 'string' && (value === '' || /^#[0-9a-f]{6}$/i.test(value));
    case 'paletteStyle':
      return (
        value === 'tonal-spot' ||
        value === 'neutral' ||
        value === 'vibrant' ||
        value === 'expressive' ||
        value === 'rainbow' ||
        value === 'fruit-salad' ||
        value === 'monochrome' ||
        value === 'fidelity' ||
        value === 'content'
      );
    case 'themeContrast':
      return value === 'standard' || value === 'medium' || value === 'high';
    case 'appearanceDensity':
      return value === 'compact' || value === 'comfortable' || value === 'spacious';
    case 'motionPreference':
      return (
        value === 'system' || value === 'expressive' || value === 'reduced' || value === 'none'
      );
    case 'navigationPosition':
      return value === 'side' || value === 'bottom';
    case 'navigationStyle':
      return value === 'standard' || value === 'floating';
    case 'language':
      return value === 'zh-CN' || value === 'en-US';
    case 'defaultInstallDir':
      return typeof value === 'string';
    case 'maxLogFileSizeMb':
      return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 1024;
    case 'maxLogArchiveDays':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650;
    case 'wallpaperType':
      return value === 'none' || value === 'image' || value === 'video';
    case 'wallpaperFileName':
      return (
        typeof value === 'string' &&
        (value === '' || /^wallpaper-[a-f0-9-]+\.(?:jpe?g|png|webp|mp4|webm)$/i.test(value))
      );
    case 'wallpaperBlur':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 20;
    case 'wallpaperDim':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 0.8;
    case 'wallpaperOpacity':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    case 'oobeCompleted':
      return typeof value === 'boolean';
    case 'home':
      return isHomeSettingsShape(value);
    default:
      return typeof value === 'boolean';
  }
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
 * 判断错误是否为文件不存在（ENOENT）错误。
 *
 * @param error - 待判断的异常对象。
 * @returns 错误码为 `ENOENT` 时返回 `true`。
 */
function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
