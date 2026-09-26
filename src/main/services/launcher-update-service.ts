import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MirrorSource } from '../../shared/domain/mirror';
import type { GithubRelease } from '../../shared/domain/github';
import type {
  LauncherBuildChannel,
  LauncherBuildInfo,
  LauncherReleaseNotes,
  LauncherUpdateInfo,
} from '../../shared/domain/app-update';
import { fetchReleaseByTag, fetchReleases } from '../utils/git/github';

/** 启动器自身所在的 GitHub 仓库；更新检查与发行页跳转均指向此仓库。 */
export const LAUNCHER_REPOSITORY = 'MoFox-Studio/Neo-MoFox-Launcher-Next';

/** 打包阶段随应用分发的版本号文件名；每夜构建流水线在打包前重写其内容。 */
const BUILD_INFO_FILE = 'version.json';

/** 一次更新检查最多消费的发行版数量，足够覆盖保留窗口内的全部每夜构建。 */
const RELEASE_LIMIT = 20;

/** 注入的 Release 查询实现签名；默认使用 GitHub 镜像轮询，测试可替换。 */
type FetchReleases = (
  mirrors: readonly MirrorSource[],
  repository: string,
  signal?: AbortSignal,
  limit?: number,
) => Promise<GithubRelease[]>;

/** 注入的按标签查询发行版实现签名；默认使用 GitHub 镜像轮询，测试可替换。 */
type FetchReleaseByTag = (
  mirrors: readonly MirrorSource[],
  repository: string,
  tag: string,
  signal?: AbortSignal,
) => Promise<GithubRelease>;

type DiagnosticReporter = (message: string, error: Error) => void;

export interface LauncherUpdateServiceOptions {
  /** 镜像源存储（结构化匹配 MirrorService）；仅消费其中的 `github` 类型镜像。 */
  mirrors: { list(): MirrorSource[] };
  /** version.json 的候选目录，按顺序探测；打包环境为 resources 目录，开发环境为项目根目录。 */
  searchPaths: readonly string[];
  /** package.json 声明的应用版本，version.json 缺失或损坏时作为兜底。 */
  appVersion: string;
  /** 注入的 Release 查询实现；缺省使用镜像轮询实现。 */
  fetchReleasesImpl?: FetchReleases;
  /** 注入的按标签查询实现；缺省使用镜像轮询实现。 */
  fetchReleaseImpl?: FetchReleaseByTag;
  /** 可选诊断回调；版本号文件读取失败等非致命问题在此上报。 */
  report?: DiagnosticReporter;
}

/**
 * 启动器自身的版本与更新服务。
 *
 * - `getBuildInfo` 解析打包时写入的 version.json 并缓存，缺失时回退为开发构建描述；
 * - `checkForUpdates` 通过 GitHub 镜像轮询查询发行版列表，选出比当前构建更新的
 *   最新发行版，返回发行说明与发行页地址，供关于页面展示与跳转。
 */
export class LauncherUpdateService {
  private readonly mirrors: { list(): MirrorSource[] };
  private readonly searchPaths: readonly string[];
  private readonly appVersion: string;
  private readonly fetchReleasesImpl: FetchReleases;
  private readonly fetchReleaseImpl: FetchReleaseByTag;
  private readonly report: DiagnosticReporter;
  private buildInfo?: LauncherBuildInfo;
  private releaseNotes?: LauncherReleaseNotes;

  constructor(options: LauncherUpdateServiceOptions) {
    this.mirrors = options.mirrors;
    this.searchPaths = options.searchPaths;
    this.appVersion = options.appVersion;
    this.fetchReleasesImpl = options.fetchReleasesImpl ?? fetchReleases;
    this.fetchReleaseImpl = options.fetchReleaseImpl ?? fetchReleaseByTag;
    this.report = options.report ?? ((message, error) => console.error(message, error));
  }

  /**
   * 读取本地构建信息；首次调用后缓存，进程生命周期内构建信息不变。
   *
   * @returns 本地构建信息；version.json 不可用时回退为开发构建描述。
   */
  async getBuildInfo(): Promise<LauncherBuildInfo> {
    this.buildInfo ??= await this.loadBuildInfo();
    return { ...this.buildInfo };
  }

  /**
   * 查询远端发行版并与当前构建比较。
   *
   * @returns 更新检查结果；无可用更新时 `updateAvailable` 为 false 且其余远端字段为空。
   * @throws {MofoxError} 所有镜像均无法获取发行版列表时抛出最后一个错误。
   */
  async checkForUpdates(): Promise<LauncherUpdateInfo> {
    const current = await this.getBuildInfo();
    const releases = await this.fetchReleasesImpl(
      this.mirrors.list(),
      LAUNCHER_REPOSITORY,
      undefined,
      RELEASE_LIMIT,
    );
    const newest = releases.find((release) => isNewerRelease(release.tag_name, current));
    if (!newest) {
      return {
        updateAvailable: false,
        current,
        latestVersion: '',
        latestTag: '',
        latestBuildDate: '',
        releaseUrl: '',
        releaseNotes: '',
        publishedAt: '',
      };
    }
    return {
      updateAvailable: true,
      current,
      latestVersion: newest.name?.trim() || newest.tag_name,
      latestTag: newest.tag_name,
      latestBuildDate: parseNightlyBuildDate(newest.tag_name) ?? '',
      releaseUrl: buildReleaseUrl(newest.tag_name),
      releaseNotes: newest.body ?? '',
      publishedAt: newest.published_at ?? '',
    };
  }

  /**
   * 读取当前构建对应发行版的更新日志。
   *
   * 开发构建没有发布标签，直接返回 `found: false`；有标签时按标签查询
   * 发行版并缓存（进程生命周期内构建不变，缓存键即当前标签）。
   *
   * @returns 当前发行版的更新日志。
   * @throws {MofoxError} 所有镜像均无法获取发行版信息时抛出最后一个错误。
   */
  async getReleaseNotes(): Promise<LauncherReleaseNotes> {
    const current = await this.getBuildInfo();
    if (!current.tag) {
      return { found: false, tag: '', name: '', notes: '', publishedAt: '', url: '' };
    }
    if (this.releaseNotes?.tag === current.tag) return { ...this.releaseNotes };
    const release = await this.fetchReleaseImpl(this.mirrors.list(), LAUNCHER_REPOSITORY, current.tag);
    const result: LauncherReleaseNotes = {
      found: true,
      tag: release.tag_name,
      name: release.name?.trim() || release.tag_name,
      notes: release.body ?? '',
      publishedAt: release.published_at ?? '',
      url: buildReleaseUrl(release.tag_name),
    };
    this.releaseNotes = result;
    return { ...result };
  }

  /**
   * 按候选目录依次探测版本号文件，全部失败时回退为开发构建描述。
   *
   * @returns 归一化后的本地构建信息。
   */
  private async loadBuildInfo(): Promise<LauncherBuildInfo> {
    const fallback = (): LauncherBuildInfo => ({
      version: this.appVersion,
      channel: 'dev',
      buildDate: '',
      tag: '',
      commit: '',
    });
    for (const directory of this.searchPaths) {
      const raw = await readFile(join(directory, BUILD_INFO_FILE), 'utf8').then(
        (content) => content,
        (error: unknown) => {
          if (isFileNotFound(error)) return null;
          this.report(
            `Unable to read build info file in ${directory}`,
            error instanceof Error ? error : new Error(String(error)),
          );
          return null;
        },
      );
      if (raw === null) continue;
      const parsed = normalizeBuildInfo(parseBuildInfoFile(raw), this.appVersion);
      if (parsed) return parsed;
      this.report(
        `Ignoring invalid build info file in ${directory}`,
        new Error(`${BUILD_INFO_FILE} 结构无效`),
      );
    }
    return fallback();
  }
}

/**
 * 解析并校验 version.json 的原始文本。
 *
 * @param raw - 文件内容。
 * @returns 校验通过的字段对象；结构不合法时返回 null。
 */
function parseBuildInfoFile(raw: string): {
  version?: unknown;
  channel?: unknown;
  buildDate?: unknown;
  tag?: unknown;
  commit?: unknown;
} | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.channel !== undefined && record.channel !== 'dev' && record.channel !== 'nightly') {
    return null;
  }
  for (const key of ['version', 'buildDate', 'tag', 'commit'] as const) {
    const item = record[key];
    if (item !== undefined && typeof item !== 'string') return null;
  }
  return record;
}

/**
 * 将校验后的字段归一化为完整的构建信息；字段缺失时保持空字符串语义。
 *
 * @param record - 已通过结构校验的字段。
 * @param appVersion - package.json 应用版本，作为 version 字段缺失时的回退。
 * @returns 可用的构建信息；channel 与 buildDate 组合非法时返回 null。
 */
function normalizeBuildInfo(
  record: ReturnType<typeof parseBuildInfoFile>,
  appVersion: string,
): LauncherBuildInfo | null {
  if (!record) return null;
  const declaredVersion = typeof record.version === 'string' ? record.version.trim() : '';
  const channel = (record.channel ?? 'dev') as LauncherBuildChannel;
  const buildDate = typeof record.buildDate === 'string' ? record.buildDate.trim() : '';
  const tag = typeof record.tag === 'string' ? record.tag.trim() : '';
  const commit = typeof record.commit === 'string' ? record.commit.trim() : '';
  // 每夜构建必须同时携带构建日期；单独的 channel 声明不足以参与更新比较。
  if (channel === 'nightly' && !/^\d{8}$/.test(buildDate)) return null;
  // 版本号由构建流水线写入（每夜构建即构建日期）；未声明时回退 package.json 版本。
  return { version: declaredVersion || appVersion, channel, buildDate, tag, commit };
}

/**
 * 解析每夜构建标签中的构建日期。
 *
 * @param tag - 发布标签，如 `nightly-20260926`。
 * @returns 8 位构建日期字符串；非每夜标签返回 null。
 */
export function parseNightlyBuildDate(tag: string): string | null {
  const match = /^nightly-(\d{8})$/.exec(tag);
  return match ? (match[1] ?? null) : null;
}

/**
 * 判断远端发行标签是否比当前本地构建更新。
 *
 * 项目只发布每夜构建：仅当本地也是每夜构建且远端构建日期更大时才算更新；
 * 开发构建没有可比基准，无法识别的标签一律视为更旧，避免误报。
 *
 * @param tag - 远端发布标签。
 * @param current - 当前本地构建信息。
 * @returns 远端更新时返回 `true`。
 */
export function isNewerRelease(tag: string, current: LauncherBuildInfo): boolean {
  const nightly = parseNightlyBuildDate(tag);
  if (!nightly) return false;
  // 仅每夜构建之间比较日期；开发构建没有可比基准，不消费每夜推送。
  return current.channel === 'nightly' && nightly > current.buildDate;
}

/**
 * 构建发行版页面地址；标签经 URL 编码防止路径注入。
 *
 * @param tag - 发布标签。
 * @returns GitHub 发行版页面地址。
 */
function buildReleaseUrl(tag: string): string {
  return `https://github.com/${LAUNCHER_REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`;
}

/**
 * 判断错误是否为文件不存在（ENOENT）错误。
 *
 * @param error - 待判断的异常对象。
 * @returns 错误码为 `ENOENT` 时返回 `true`。
 */
function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  );
}
