import { join } from 'node:path';
import type { Instance } from '../../shared/domain/instance';
import type { ManualImportRequest, ManualImportResult } from '../../shared/domain/manual-import';
import type { BotPlatform } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import type { CreateInstanceInput } from '../../shared/domain/instance';
import { requireDirectory, requireFile, samePath } from '../utils/path-inspection';

/** 已有实例导入时依赖的最小仓库能力。 */
interface InstanceRepository {
  list(): Promise<Instance[]>;
  create(input: CreateInstanceInput): Promise<Instance>;
}

/** 导入时按 ID 解析平台实例；未知 ID 抛出 NOT_FOUND。 */
interface PlatformResolver {
  get(platformId: string): BotPlatform;
}

/**
 * 将用户选择的现有 Neo-MoFox 目录注册为实例，不下载、移动或修改被导入的文件。
 */
export class ManualImportService {
  constructor(
    private readonly repository: InstanceRepository,
    private readonly platforms: PlatformResolver,
  ) {}

  /**
   * 验证已有目录和可选平台目录，并将实例写入仓库。
   *
   * 平台目录在最终写入前会被再次校验，确保登记的平台目录可以被对应平台启动。
   *
   * @param request - 来自手动导入向导的实例信息。
   * @returns 新建实例的唯一 ID。
   */
  async importInstance(request: ManualImportRequest): Promise<ManualImportResult> {
    const instanceName = requireText(request.instanceName, '实例名称不能为空');
    if (instanceName.length > 32) {
      throw new MofoxError('INVALID_ARGUMENT', '实例名称不能超过 32 个字符');
    }
    const mofoxInstallDir = await requireDirectory(request.mofoxInstallDir, 'Neo-MoFox 安装目录');
    await requireFile(
      join(mofoxInstallDir, 'main.py'),
      '所选目录不是有效的 Neo-MoFox 安装目录（缺少 main.py）',
    );

    const platformId = request.platformId?.trim() ?? '';
    const platformDir = request.platformDir?.trim() ?? '';
    if (Boolean(platformId) !== Boolean(platformDir)) {
      throw new MofoxError('INVALID_ARGUMENT', '平台名称和平台目录需要同时填写');
    }
    if (platformId && !/^[a-z][a-z0-9_-]*$/i.test(platformId)) {
      throw new MofoxError('INVALID_ARGUMENT', '平台名称格式无效');
    }
    const resolvedPlatformDir = platformDir
      ? await requireDirectory(platformDir, '平台安装目录')
      : undefined;

    // 导入时再次核验平台目录：目录必须能按该平台解析出启动入口。
    if (platformId && resolvedPlatformDir) {
      const platform = this.platforms.get(platformId);
      try {
        await platform.getStartCommand(resolvedPlatformDir);
      } catch {
        throw new MofoxError('INVALID_ARGUMENT', `所选目录不是有效的 ${platform.name} 安装目录`);
      }
    }

    const existing = await this.repository.list();
    if (
      existing.some(
        (instance) =>
          Boolean(instance.mofoxInstallDir.trim()) &&
          samePath(instance.mofoxInstallDir, mofoxInstallDir),
      )
    ) {
      throw new MofoxError('CONFLICT', '此 Neo-MoFox 安装目录已被导入');
    }

    const instance = await this.repository.create({
      name: instanceName,
      mofoxInstallDir,
      platform:
        platformId && resolvedPlatformDir
          ? { id: platformId, installDir: resolvedPlatformDir, version: null }
          : { id: null, installDir: null, version: null },
    });
    return { instanceId: instance.id };
  }
}

/** 确保必填文本在进入业务层前已经去除首尾空白。 */
function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new MofoxError('INVALID_ARGUMENT', message);
  return trimmed;
}
