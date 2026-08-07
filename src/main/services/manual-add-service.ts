import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Instance,
} from '../../shared/domain/instance';
import type { ManualAddRequest, ManualAddResult } from '../../shared/domain/manual-add';
import { generateInstanceId } from '../utils/id-generator';
import { execCommand } from '../utils/platform-helper';

/**
 * 手动添加实例服务：通过用户提供的目录路径快速注册已有实例。
 * 不做任何下载或安装，仅探测 Git 信息并写入实例仓库。
 */
interface Repository {
  list(): Promise<Instance[]>;
  upsert(instance: Instance): Promise<void>;
}

export class ManualAddService {
  constructor(private readonly repository: Repository) {}

  /**
   * 手动添加实例。
   *
   * @param request - 用户填写的实例信息。
   * @returns 结果对象；成功后包含生成的实例 ID 与探测到的频道。
   */
  async add(request: ManualAddRequest): Promise<ManualAddResult> {
    const mofoxInstallDir = request.mofoxInstallDir?.trim();
    if (!mofoxInstallDir) {
      return { success: false, error: '缺少 MoFox 目录路径' };
    }
    try {
      await access(mofoxInstallDir);
    } catch {
      return { success: false, error: `MoFox 目录不存在: ${mofoxInstallDir}` };
    }

    if (request.platformId && request.platformDir) {
      try {
        await access(request.platformDir);
      } catch {
        return { success: false, error: '平台目录不存在' };
      }
    }
    if (request.platformId && !request.platformDir) {
      return { success: false, error: '已选择平台，请同时填写平台目录' };
    }

    // 探测 Git 分支与提交作为频道与版本信息。
    let channel = 'dev';
    let commit = '';
    try {
      await access(join(mofoxInstallDir, '.git'));
      const [branchResult, commitResult] = await Promise.all([
        execCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: mofoxInstallDir,
          timeoutMs: 5000,
        }),
        execCommand('git', ['rev-parse', '--short=7', 'HEAD'], {
          cwd: mofoxInstallDir,
          timeoutMs: 5000,
        }),
      ]);
      channel = branchResult.stdout.trim() || channel;
      commit = commitResult.stdout.trim();
    } catch {
      // 非 Git 目录或探测失败时保持默认值。
    }

    const displayName = request.displayName?.trim() || channel || mofoxInstallDir.split(/[\\/]/).pop() || '未知实例';
    const instance: Instance = {
      id: generateInstanceId(),
      name: displayName,
      version: commit || 'unknown',
      mofoxInstallDir,
      platforms: request.platformId && request.platformDir
        ? { [request.platformId]: request.platformDir }
        : {},
      status: 'stopped',
      createdAt: Date.now(),
      autoStart: false,
    };

    await this.repository.upsert(instance);
    return { success: true, instanceId: instance.id, channel };
  }
}