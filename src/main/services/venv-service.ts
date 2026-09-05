import { access, stat } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import type { Instance } from '../../shared/domain/instance';
import type { MirrorSource } from '../../shared/domain/mirror';
import type {
  VenvInfo,
  VenvPackage,
  VenvPackageResult,
  VenvPathInspection,
} from '../../shared/domain/venv';
import { MofoxError } from '../../shared/domain/error';
import { execCommand, isWindows, pythonExeName } from '../utils/platform-helper';
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
const INDEX_TIMEOUT_MS = 90_000;

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
  ) {}

  /**
   * 探测虚拟环境路径的绝对性、存在性、目录类型、有效性（`pyvenv.cfg`）与 Python 解释器。
   *
   * @param value - 用户填写的 venv 目录路径。
   * @returns 非阻断的路径探测结果，供输入时即时校验。
   */
  async inspect(path: string): Promise<VenvPathInspection> {
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
   * @param instanceId - 实例 ID。
   * @param name - 包名。
   * @returns 从高到低排列的可用版本字符串列表。
   */
  async queryVersions(instanceId: string, name: string): Promise<string[]> {
    const packageName = requirePackageName(name);
    const instance = await this.find(instanceId);
    const python = await this.resolvePython(instance);
    return this.tryEachPipMirror(
      (mirror) => this.queryVersionsFrom(mirror, packageName, python),
      '查询可用版本失败',
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
   * @param instanceId - 实例 ID。
   * @param name - 可选的目标包名。
   * @returns 升级结果摘要。
   */
  async upgrade(instanceId: string, name?: string): Promise<VenvPackageResult> {
    const instance = await this.find(instanceId);
    const python = await this.resolvePython(instance);
    const target = name?.trim();
    if (target) requirePackageName(target);
    try {
      const args = ['pip', 'install', '--python', python, '--upgrade'];
      if (target) args.push(target);
      else args.push('--all');
      await this.tryEachPipMirror(
        (mirror) =>
          this.runUv([...args, '--index-url', mirror.baseUrl], { timeoutMs: INSTALL_TIMEOUT_MS }),
        `升级 ${target ?? '全部依赖'} 失败`,
      );
      return { name: target ?? '*', upgraded: true, ok: true };
    } catch (error) {
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
  private async pythonOf(venvDir: string): Promise<string | undefined> {
    const candidate = join(venvDir, isWindows() ? 'Scripts' : 'bin', pythonExeName());
    try {
      await access(candidate);
      return candidate;
    } catch {
      return undefined;
    }
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

  private async queryVersionsFrom(
    mirror: MirrorSource,
    name: string,
    python: string,
  ): Promise<string[]> {
    const result = await this.runUv(
      ['pip', 'index', 'versions', name, '--python', python, '--index-url', mirror.baseUrl],
      { timeoutMs: INDEX_TIMEOUT_MS },
    );
    return parseAvailableVersions(result.stdout);
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

/** 从 `uv pip index versions` 输出中提取可用版本列表。 */
function parseAvailableVersions(stdout: string): string[] {
  const versions = new Set<string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/^\d/.test(line)) continue;
    if (line.toLowerCase().includes('available versions')) continue;
    if (/^\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.+-]*)?$/.test(line)) versions.add(line);
  }
  return [...versions].reverse();
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
