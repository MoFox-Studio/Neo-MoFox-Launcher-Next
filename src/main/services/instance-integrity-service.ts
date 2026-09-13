import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Instance } from '../../shared/domain/instance';
import type {
  InstanceIntegrityIssue,
  InstanceIntegrityProblem,
} from '../../shared/domain/instance';
import type { BotPlatform } from '../../shared/domain/bot-platform';

/**
 * 实例完整性检查服务：在启动器启动时逐一核验实例的磁盘文件是否齐全。
 *
 * 校验范围与实例管理写入前的核验保持一致：主程序目录必须存在且含 `main.py`；
 * 已配置平台的安装目录必须能被该平台的启动入口探测解析。虚拟环境由 uv 自动重建，
 * 因此不作为残缺判定。
 */
export class InstanceIntegrityService {
  constructor(
    private readonly repository: { list(): Promise<Instance[]> },
    private readonly platforms: { get(platformId: string): BotPlatform },
  ) {}

  /**
   * 检查全部实例的文件完整性。
   *
   * @returns 仅包含存在缺失项实例的问题列表；全部完整时返回空数组。
   */
  async check(): Promise<InstanceIntegrityIssue[]> {
    const instances = await this.repository.list();
    const issues: InstanceIntegrityIssue[] = [];
    for (const instance of instances) {
      const problems = await this.inspect(instance);
      if (problems.length > 0) {
        issues.push({ instanceId: instance.id, name: instance.name, problems });
      }
    }
    return issues;
  }

  /**
   * 核验单个实例的缺失项。
   *
   * @param instance - 待核验的实例记录。
   * @returns 缺失项数组；完整时为 `[]`。
   */
  private async inspect(instance: Instance): Promise<InstanceIntegrityProblem[]> {
    const problems: InstanceIntegrityProblem[] = [];
    const mofoxDir = instance.mofoxInstallDir?.trim();
    if (mofoxDir && !(await isValidMofoxDirectory(mofoxDir))) {
      problems.push('mofox');
    }
    const platform = instance.platform;
    if (platform?.id && platform?.installDir) {
      if (!(await hasResolvablePlatformEntry(this.platforms, platform.id, platform.installDir))) {
        problems.push('platform');
      }
    }
    return problems;
  }
}

/**
 * 判断目录是否为有效的 MoFox 安装目录（存在且含 `main.py`）。
 *
 * @param directory - 待核验的目录绝对路径。
 * @returns 目录存在且 `main.py` 可访问时返回 `true`。
 */
async function isValidMofoxDirectory(directory: string): Promise<boolean> {
  try {
    if (!(await stat(directory)).isDirectory()) return false;
    await access(join(directory, 'main.py'));
    return true;
  } catch {
    return false;
  }
}

/**
 * 判断平台安装目录能否被对应平台的启动入口探测解析。
 *
 * @param platforms - 按 ID 解析平台实例的注册表。
 * @param platformId - 平台适配器 ID。
 * @param installDir - 平台适配器安装目录绝对路径。
 * @returns 启动入口可解析时返回 `true`。
 */
async function hasResolvablePlatformEntry(
  platforms: { get(platformId: string): BotPlatform },
  platformId: string,
  installDir: string,
): Promise<boolean> {
  try {
    await platforms.get(platformId).getStartCommand(installDir);
    return true;
  } catch {
    return false;
  }
}
