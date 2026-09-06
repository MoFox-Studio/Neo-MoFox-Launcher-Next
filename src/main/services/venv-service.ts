import { access, stat } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import type { Instance } from '../../shared/domain/instance';
import type { MirrorSource } from '../../shared/domain/mirror';
import type {
  VenvInfo,
  VenvPackage,
  VenvPackageInfo,
  VenvPackageResult,
  VenvPathInspection,
  VenvProgressEvent,
} from '../../shared/domain/venv';
import { MofoxError } from '../../shared/domain/error';
import { execCommand } from '../utils/platform-helper';
import { venvPythonOf } from '../utils/platform-helper';
import type { ExecOptions, ExecResult } from '../utils/process-helper';

/** uv 命令在指定 venv 上执行的最小仓库与镜像能力。 */
export interface VenvDependencies {
  list(): Promise<Instance[]>;
  mirrors: { list(): MirrorSource[] };
}

/** 与外部 `uv` 命令解耦的命令执行器；注入替身便于单元测试。 */
export type VenvCommandRunner = (
  command: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

const LIST_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 600_000;

/**
 * 虚拟环境管理服务：基于 uv 对实例的 venv 目录执行包列表、安装、卸载与升级。
 *
 * 所有 venv 均视为 uv 虚拟环境，通过 `uv pip --python <venv python>` 定位目标解释器。
 * 涉及包索引的操作按内置 pip 镜像顺序轮询，首个成功即采用，全部失败才抛出错误。
 */
export class VenvService {
  constructor(
    private readonly dependencies: VenvDependencies,
    private readonly run: VenvCommandRunner = execCommand,
    private readonly events: { progress(event: VenvProgressEvent): void } = {
      progress: () => undefined,
    },
  ) {}

  /**
   * 探测虚拟环境路径的绝对性、存在性、目录类型、有效性（`pyvenv.cfg`）与 Python 解释器。
   *
   * 路径为空或目录内缺少 Python 解释器时直接抛错，不再返回可放行的降级结果。
   *
   * @param value - 用户填写的 venv 目录路径。
   * @returns 路径探测结果，供输入时即时校验。
   * @throws {MofoxError} 路径为空抛 `INVALID_ARGUMENT`；未找到 Python 解释器抛 `UNAVAILABLE`。
   */
  async inspect(path: string): Promise<VenvPathInspection> {
    if (!path.trim()) {
      throw new MofoxError('INVALID_ARGUMENT', '虚拟环境路径不能为空');
    }
    const absolute = isAbsolute(path);
    if (!absolute) {
      return {
        absolute: false,
        exists: false,
        isDirectory: false,
        valid: false,
        pythonExists: false,
      };
    }
    const resolved = resolve(path);
    let isDirectory: boolean;
    try {
      isDirectory = (await stat(resolved)).isDirectory();
    } catch {
      return {
        absolute: true,
        exists: false,
        isDirectory: false,
        valid: false,
        pythonExists: false,
      };
    }
    if (!isDirectory) {
      return {
        absolute: true,
        exists: true,
        isDirectory: false,
        valid: false,
        pythonExists: false,
      };
    }
    const [valid, pythonExists] = await Promise.all([
      fileExists(join(resolved, 'pyvenv.cfg')),
      this.pythonOf(resolved).then(Boolean),
    ]);
    if (!pythonExists) {
      throw new MofoxError('UNAVAILABLE', '虚拟环境尚未创建：未找到 Python 解释器');
    }
    return { absolute: true, exists: true, isDirectory: true, valid, pythonExists };
  }

  /**
   * 汇总虚拟环境信息：有效性与 Python 解释器、已安装包列表与可升级依赖。
   *
   * 包列表在离线状态下即可读取；可升级依赖需要连接包索引，按镜像轮询获取，
   * 全部失败时保留已安装包并返回 `upgradeError`。
   *
   * @param instanceId - 实例 ID。
   * @returns 虚拟环境信息摘要。
   */
  async getVenvInfo(instanceId: string): Promise<VenvInfo> {
    const instance = await this.find(instanceId);
    const python = await this.resolvePython(instance);
    const packages = await this.listPackages(python);
    const base: VenvInfo = {
      valid: true,
      pythonExists: true,
      packages,
      hasUpgrades: false,
      upgrades: [],
    };
    const outdated = await this.checkOutdated(python);
    if (outdated === null) return base;
    const upgrades = outdated
      .map(({ name, version, latest_version }) => ({
        name,
        current: version,
        latest: latest_version ?? '',
      }))
      .filter((upgrade) => Boolean(upgrade.latest));
    return {
      ...base,
      hasUpgrades: upgrades.length > 0,
      upgrades,
    };
  }

  /**
   * 查询指定包在 pip 镜像上可用的全部版本，用于安装前选择版本。
   *
   * 通过 PEP 503 simple index（`<mirror>/<normalized-name>/`）逐个镜像轮询，
   * 从返回的下载链接中解析版本号，首个成功的镜像结果即采用。
   *
   * @param instanceId - 实例 ID。
   * @param name - 包名。
   * @returns 从高到低排列的可用版本字符串列表。
   */
  async queryVersions(instanceId: string, name: string): Promise<string[]> {
    const packageName = requirePackageName(name);
    const instance = await this.find(instanceId);
    await this.resolvePython(instance);
    return this.tryEachPipMirror(
      (mirror) => fetchSimpleVersions(mirror.baseUrl, packageName),
      '查询可用版本失败',
    );
  }

  /**
   * 查询指定包的介绍、作者与 PyPI 跳转地址等信息。
   *
   * 通过各 pip 镜像的 PyPI JSON API（`<mirror>/pypi/<name>/json`）逐个轮询，
   * 首个返回有效信息的镜像即采用。
   *
   * @param instanceId - 实例 ID。
   * @param name - 包名。
   * @returns 包含简介、长描述、作者与项目链接的包信息。
   */
  async getVenvPackageInfo(instanceId: string, name: string): Promise<VenvPackageInfo> {
    const packageName = requirePackageName(name);
    const instance = await this.find(instanceId);
    await this.resolvePython(instance);
    return this.tryEachPipMirror(
      (mirror) => fetchPackageInfo(mirror.baseUrl, packageName),
      `获取 ${packageName} 信息失败`,
    );
  }

  /**
   * 安装指定包；版本省略时安装最新版。
   *
   * 按内置 pip 镜像顺序轮询：先以当前镜像尝试安装，失败后切换到下一个镜像。
   *
   * @param instanceId - 实例 ID。
   * @param name - 包名。
   * @param version - 可选的目标版本号；缺省安装最新版。
   * @returns 安装结果摘要。
   */
  async install(instanceId: string, name: string, version?: string): Promise<VenvPackageResult> {
    const packageName = requirePackageName(name);
    const instance = await this.find(instanceId);
    const python = await this.resolvePython(instance);
    const spec = version ? `${packageName}==${version.trim()}` : packageName;
    try {
      await this.tryEachPipMirror(
        (mirror) =>
          this.runUv(['pip', 'install', '--python', python, '--index-url', mirror.baseUrl, spec], {
            timeoutMs: INSTALL_TIMEOUT_MS,
          }),
        `安装 ${packageName} 失败`,
      );
      return { name: packageName, version: version?.trim(), installed: true, ok: true };
    } catch (error) {
      return {
        name: packageName,
        version: version?.trim(),
        installed: false,
        ok: false,
        message: describe(error),
      };
    }
  }

  /**
   * 卸载指定包。
   *
   * @param instanceId - 实例 ID。
   * @param name - 包名。
   * @returns 卸载结果摘要。
   */
  async uninstall(instanceId: string, name: string): Promise<VenvPackageResult> {
    const packageName = requirePackageName(name);
    const instance = await this.find(instanceId);
    const python = await this.resolvePython(instance);
    try {
      await this.runUv(['pip', 'uninstall', '--python', python, '-y', packageName], {
        timeoutMs: INSTALL_TIMEOUT_MS,
      });
      return { name: packageName, removed: true, ok: true };
    } catch (error) {
      return { name: packageName, removed: false, ok: false, message: describe(error) };
    }
  }

  /**
   * 升级单个包到最新版；`name` 省略时升级全部可升级依赖。
   *
   * 升级期间通过 `venv-progress` 事件推送进度，供渲染端弹出进度弹窗。
   *
   * @param instanceId - 实例 ID。
   * @param name - 可选的目标包名。
   * @returns 升级结果摘要。
   */
  async upgrade(instanceId: string, name?: string): Promise<VenvPackageResult> {
    const instance = await this.find(instanceId);
    const python = await this.resolvePython(instance);
    const target = name?.trim();
    if (target) requirePackageName(target);
    const phase: VenvProgressEvent['phase'] = target ? 'upgrade' : 'upgrade-all';
    try {
      // 升级全部时先查询可升级依赖，把包名一次性交给 uv，避免 `--all` 不可用。
      const names = target
        ? [target]
        : ((await this.checkOutdated(python))?.map((item) => item.name) ?? []);
      if (names.length === 0) {
        this.emitProgress(instanceId, phase, 1, target ? `已升级 ${target}` : '没有需要升级的依赖');
        return { name: target ?? '*', upgraded: true, ok: true };
      }
      this.emitProgress(
        instanceId,
        phase,
        0.3,
        target ? `正在升级 ${target}...` : `正在升级 ${names.length} 个依赖...`,
      );
      const args = ['pip', 'install', '--python', python, '--upgrade', ...names];
      await this.tryEachPipMirror(
        (mirror) =>
          this.runUv([...args, '--index-url', mirror.baseUrl], { timeoutMs: INSTALL_TIMEOUT_MS }),
        `升级 ${target ?? '全部依赖'} 失败`,
      );
      this.emitProgress(instanceId, phase, 1, target ? `已升级 ${target}` : '全部依赖升级完成');
      return { name: target ?? '*', upgraded: true, ok: true };
    } catch (error) {
      this.emitProgress(instanceId, phase, 0, `升级失败: ${describe(error)}`);
      return { name: target ?? '*', upgraded: false, ok: false, message: describe(error) };
    }
  }

  // ─── 内部实现 ─────────────────────────────────────────────────────

  private async find(instanceId: string): Promise<Instance> {
    if (!instanceId.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
    const instance = (await this.dependencies.list()).find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance) throw new MofoxError('NOT_FOUND', `未知实例: ${instanceId}`);
    return instance;
  }

  /** 解析实例 venv 目录下的 Python 解释器；缺失时抛出可读错误。 */
  private async resolvePython(instance: Instance): Promise<string> {
    const venvDir = instance.venvDir?.trim();
    if (!venvDir) throw new MofoxError('INVALID_ARGUMENT', '实例未配置虚拟环境目录');
    const python = await this.pythonOf(venvDir);
    if (!python) {
      throw new MofoxError(
        'UNAVAILABLE',
        '虚拟环境尚未创建：未找到 Python 解释器。请先启动主程序或运行 uv sync 同步依赖。',
      );
    }
    return python;
  }

  /** 返回 venv 目录下的 Python 解释器绝对路径；不存在时为 `undefined`。 */
  private pythonOf(venvDir: string): Promise<string | undefined> {
    return venvPythonOf(venvDir);
  }

  /** 读取已安装包列表（离线，不访问索引）。 */
  private async listPackages(python: string): Promise<VenvPackage[]> {
    const result = await this.runUv(['pip', 'list', '--python', python, '--format', 'json'], {
      timeoutMs: LIST_TIMEOUT_MS,
    });
    return parsePackageList(result.stdout);
  }

  /**
   * 查询可升级依赖；全部镜像失败时返回 `null` 表示未知，由调用方降级处理。
   */
  private async checkOutdated(python: string): Promise<VenvUpgradeRaw[] | null> {
    try {
      return await this.tryEachPipMirror(
        (mirror) =>
          this.runUv(
            [
              'pip',
              'list',
              '--outdated',
              '--python',
              python,
              '--format',
              'json',
              '--index-url',
              mirror.baseUrl,
            ],
            {
              timeoutMs: LIST_TIMEOUT_MS,
            },
          ).then((result) => parseOutdatedList(result.stdout)),
        '检查可升级依赖失败',
      );
    } catch {
      return null;
    }
  }

  /** 向渲染端推送虚拟环境操作进度事件。 */
  private emitProgress(
    instanceId: string,
    phase: VenvProgressEvent['phase'],
    percent: number,
    message: string,
    error?: string,
  ): void {
    this.events.progress({ instanceId, phase, percent, message, ...(error ? { error } : {}) });
  }

  /** 按内置 pip 镜像顺序执行操作，首个成功即返回，全部失败时抛出可读错误。 */
  private async tryEachPipMirror<T>(
    run: (mirror: MirrorSource) => Promise<T>,
    failureMessage: string,
  ): Promise<T> {
    const sources = this.dependencies.mirrors.list().filter((mirror) => mirror.type === 'pip');
    if (sources.length === 0) throw new MofoxError('UNAVAILABLE', '未配置任何 pip 镜像源');
    let lastError: unknown;
    for (const mirror of sources) {
      try {
        return await run(mirror);
      } catch (error) {
        lastError = error;
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new MofoxError('UNAVAILABLE', `${failureMessage}。最后一个错误：${detail}`);
  }

  /** 执行 uv 命令；失败时抛出包含 stderr 的 MofoxError。 */
  private async runUv(args: readonly string[], options: ExecOptions): Promise<ExecResult> {
    let result: ExecResult;
    try {
      result = await this.run('uv', args, options);
    } catch (error) {
      throw new MofoxError('UNAVAILABLE', `uv 执行失败: ${describe(error)}`);
    }
    if (result.exitCode !== 0) {
      const stderr = `${result.stderr ?? ''}`.trim();
      throw new MofoxError(
        'IO_ERROR',
        `uv ${args[1]} 失败: ${stderr || `退出码 ${result.exitCode}`}`,
      );
    }
    return result;
  }
}

/** uv `pip list --outdated --format json` 的原始条目。 */
interface VenvUpgradeRaw {
  name: string;
  version: string;
  latest_version?: string;
}

/** 校验包名，拒绝空值。 */
function requirePackageName(value: string): string {
  const name = value.trim();
  if (!name) throw new MofoxError('INVALID_ARGUMENT', '包名不能为空');
  return name;
}

/** 解析 `uv pip list --format json` 输出。 */
function parsePackageList(stdout: string): VenvPackage[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is { name: string; version: string } =>
          isRecord(entry) && typeof entry.name === 'string' && typeof entry.version === 'string',
      )
      .map((entry) => ({ name: entry.name, version: entry.version }));
  } catch {
    return [];
  }
}

/** 解析 `uv pip list --outdated --format json` 输出，保留可升级依赖的版本字段。 */
function parseOutdatedList(stdout: string): VenvUpgradeRaw[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is VenvUpgradeRaw =>
          isRecord(entry) && typeof entry.name === 'string' && typeof entry.version === 'string',
      )
      .map((entry) => ({
        name: entry.name,
        version: entry.version,
        latest_version: typeof entry.latest_version === 'string' ? entry.latest_version : undefined,
      }));
  } catch {
    return [];
  }
}

/**
 * 通过 PEP 503 simple index 抓取包的全部可用版本。
 *
 * 访问 `<mirror>/<normalized-name>/`，从 HTML 或 JSON（PEP 691）的文件名中解析版本号。
 *
 * @param mirrorBase - pip 镜像的 simple index 根地址。
 * @param name - 原始包名（内部会规范化为 PEP 503 格式）。
 * @returns 从高到低排列的可用版本列表。
 * @throws {MofoxError} 请求失败或无法解析版本时抛出。
 */
async function fetchSimpleVersions(mirrorBase: string, name: string): Promise<string[]> {
  const normalized = normalizePep503Name(name);
  const url = `${mirrorBase.replace(/\/+$/, '')}/${normalized}/`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new MofoxError('IO_ERROR', `无法连接镜像 ${mirrorBase}: ${describe(error)}`);
  }
  if (!response.ok) {
    throw new MofoxError('IO_ERROR', `镜像 ${mirrorBase} 返回 ${response.status}`);
  }
  const text = await response.text();
  const versions = extractVersionsFromIndex(text, normalized);
  if (versions.length === 0) {
    throw new MofoxError('IO_ERROR', `镜像 ${mirrorBase} 未返回可用版本`);
  }
  return sortVersionsDesc(versions);
}

/** 按 PEP 503 规范规范化包名：小写、`-`/`_`/`.` 统一为 `-` 并折叠连续分隔符。 */
function normalizePep503Name(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * 从镜像的 PyPI JSON API 抓取包信息。
 *
 * 访问 `<mirror>/pypi/<normalized-name>/json`，从返回的 `info` 段解析简介与描述。
 *
 * @param mirrorBase - pip 镜像的 simple index 根地址。
 * @param name - 原始包名（内部会规范化为 PEP 503 格式）。
 * @returns 包信息摘要。
 * @throws {MofoxError} 请求失败或返回结构无效时抛出。
 */
async function fetchPackageInfo(mirrorBase: string, name: string): Promise<VenvPackageInfo> {
  const normalized = normalizePep503Name(name);
  const jsonBase = mirrorBase.replace(/\/+$/, '').replace(/\/simple$/, '');
  const url = `${jsonBase}/pypi/${normalized}/json`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new MofoxError('IO_ERROR', `无法连接镜像 ${mirrorBase}: ${describe(error)}`);
  }
  if (!response.ok) {
    throw new MofoxError('IO_ERROR', `镜像 ${mirrorBase} 返回 ${response.status}`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new MofoxError('IO_ERROR', `镜像 ${mirrorBase} 未返回有效的 JSON`);
  }
  return parsePackageInfo(data, normalized);
}

/** 从 PyPI JSON API 的 `info` 段提取包信息字段。 */
function parsePackageInfo(data: unknown, normalizedName: string): VenvPackageInfo {
  if (!isRecord(data) || !isRecord(data.info)) {
    throw new MofoxError('IO_ERROR', `镜像未返回 ${normalizedName} 的包信息`);
  }
  const info = data.info;
  const projectUrls = isRecord(info.project_urls)
    ? (Object.fromEntries(
        Object.entries(info.project_urls).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ) as Record<string, string>)
    : {};
  return {
    name: typeof info.name === 'string' && info.name ? info.name : normalizedName,
    version: typeof info.version === 'string' ? info.version : '',
    summary: typeof info.summary === 'string' ? info.summary : '',
    description: typeof info.description === 'string' ? info.description : '',
    author: typeof info.author === 'string' ? info.author : '',
    requiresPython: typeof info.requires_python === 'string' ? info.requires_python : '',
    homePage: typeof info.home_page === 'string' ? info.home_page : '',
    projectUrls,
    pypiUrl: `https://pypi.org/project/${normalizedName}/`,
  };
}

/** 从 simple index 的 HTML/JSON 文件名中提取并去重版本号。 */
function extractVersionsFromIndex(text: string, normalizedName: string): string[] {
  const versions = new Set<string>();
  // PEP 691 JSON：`{"files": [{"filename": "pkg-1.2.3-...whl"}]}`
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed.files)) {
      for (const file of parsed.files) {
        if (isRecord(file) && typeof file.filename === 'string') {
          const version = versionFromFilename(file.filename, normalizedName);
          if (version) versions.add(version);
        }
      }
      return [...versions];
    }
  } catch {
    // 不是 JSON 时按 HTML 解析。
  }
  // PEP 503 HTML：`<a href="...pkg-1.2.3-...whl">pkg-1.2.3-...whl</a>`
  const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    const href = match[1];
    const filename = decodeURIComponent(href.split('/').pop() ?? '');
    const version = versionFromFilename(filename, normalizedName);
    if (version) versions.add(version);
  }
  return [...versions];
}

/**
 * 从 simple index 的文件名中提取版本号。
 *
 * 文件名形如 `pkg-1.2.3-cp311-cp311-manylinux...whl#sha256=...` 或
 * `pkg-1.2.3.tar.gz#sha256=...`；版本号位于包名前缀之后、构建标记
 * （`-py`/`-cp`/`-abi`/扩展名）之前。发行版文件名中的连字符可能写作
 * 下划线（如 `pydantic_core`），前缀匹配时一并容忍。
 */
function versionFromFilename(filename: string, normalizedName: string): string | null {
  const lower = filename.split('#')[0].toLowerCase();
  // 包名中 `-` 与 `_` 等价（PEP 503 规范化），文件名里的分隔符可能为下划线。
  const namePattern = normalizedName.replace(/-/g, '[-_]');
  const match = lower.match(new RegExp(`^${namePattern}-(.+)$`));
  if (!match) return null;
  // 包名之后的第一段即版本号（wheel 的构建标记以 `-` 分隔，sdist 以扩展名结尾）。
  const first = match[1].split('-')[0];
  const version = first.replace(/\.(tar\.gz|tar\.bz2|zip|whl|tgz|tar)$/, '');
  if (!version || !/^\d/.test(version)) return null;
  const cleaned = version
    .split('+')[0]
    .replace(/\.post\d+$/, '')
    .replace(/\.dev\d+$/, '');
  if (/^\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.+-]*)?$/.test(cleaned)) return cleaned;
  return null;
}

/** 把版本字符串按从高到低排序（朴素比较：数字按段数值比较）。 */
function sortVersionsDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersionsDesc(a, b));
}

/** 比较两个语义化版本，返回 `a` 相对 `b` 的降序比较结果。 */
function compareVersionsDesc(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.split(/[.+_-]/).map((part) => {
      const num = Number.parseInt(part, 10);
      return Number.isNaN(num) ? part.charCodeAt(0) : num;
    });
  const aParts = parse(a);
  const bParts = parse(b);
  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i += 1) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av > bv) return -1;
    if (av < bv) return 1;
  }
  return 0;
}

/** 判断值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 检查文件是否存在。 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 把任意异常转成可读文本。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
