import { stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Instance } from '../../shared/domain/instance';
import type { ManualImportRequest, ManualImportResult } from '../../shared/domain/manual-import';
import { MofoxError } from '../../shared/domain/error';
import type { CreateInstanceInput } from '../../shared/domain/instance';

/** 已有实例导入时依赖的最小仓库能力。 */
interface InstanceRepository {
  list(): Promise<Instance[]>;
  create(input: CreateInstanceInput): Promise<Instance>;
}

/**
 * 将用户选择的现有 Neo-MoFox 目录注册为实例，不下载、移动或修改被导入的文件。
 */
export class ManualImportService {
  constructor(private readonly repository: InstanceRepository) {}

  /**
   * 验证已有目录和可选平台目录，并将实例写入仓库。
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

/** 读取并规范化目录路径，拒绝不存在或非目录的用户输入。 */
async function requireDirectory(value: string, label: string): Promise<string> {
  const path = requireText(value, `${label}不能为空`);
  if (!isAbsolute(path)) throw new MofoxError('INVALID_ARGUMENT', `${label}必须是绝对路径`);
  const resolved = resolve(path);
  try {
    if (!(await stat(resolved)).isDirectory()) {
      throw new MofoxError('INVALID_ARGUMENT', `${label}必须是目录`);
    }
  } catch (error) {
    if (error instanceof MofoxError) throw error;
    throw new MofoxError('NOT_FOUND', `${label}不存在: ${resolved}`);
  }
  return resolved;
}

/** 读取文件存在性，避免注册无法由运行时启动的 Neo-MoFox 目录。 */
async function requireFile(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isFile()) throw new MofoxError('NOT_FOUND', message);
  } catch (error) {
    if (error instanceof MofoxError) throw error;
    throw new MofoxError('NOT_FOUND', message);
  }
}

/** 确保必填文本在进入持久化层前已经去除首尾空白。 */
function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new MofoxError('INVALID_ARGUMENT', message);
  return trimmed;
}

/** Windows 文件系统路径不区分大小写，其余平台按原始规范化路径比较。 */
function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === right.toLowerCase()
    : normalizedLeft === right;
}
