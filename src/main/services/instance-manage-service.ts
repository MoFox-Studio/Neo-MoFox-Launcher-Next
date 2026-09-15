import { randomUUID } from 'node:crypto';
import { access, rename, realpath, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  EditableInstancePatch,
  Instance,
  UpdateInstancePatch,
} from '../../shared/domain/instance';
import type { BotPlatform } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import type { InstanceRuntimeService } from './instance-runtime-service';
import { inferVenvDir } from '../utils/instance-migrations';
import { requireDirectory, requireFile, requireVenvDir } from '../utils/path-inspection';

/**
 * 实例管理服务：负责删除、打开安装目录与更新配置。
 *
 * 删除前先经运行服务优雅停机，再删除 MoFox 本体目录、持久化记录并清理运行时日志缓冲；
 * 打开目录则直接把 MoFox 本体安装目录交给系统文件管理器；
 * 更新配置前会核验主程序与平台目录，确认可被运行时启动后再委托仓库持久化。
 */
export class InstanceManageService {
  constructor(
    private readonly runtime: Pick<InstanceRuntimeService, 'withStoppedSources' | 'clearLogs'>,
    private readonly repository: {
      list(): Promise<Instance[]>;
      remove(instanceId: string): Promise<void>;
      update(instanceId: string, patch: UpdateInstancePatch): Promise<Instance>;
    },
    private readonly platforms: { get(platformId: string): BotPlatform },
    private readonly removePath: (path: string) => Promise<void>,
    private readonly openPath: (path: string) => Promise<void>,
  ) {}

  /**
   * 删除实例：先经运行服务停止进程，再删除 MoFox 本体目录与持久化记录，并清理运行时日志缓冲。
   *
   * @param instanceId - 待删除的实例 ID。
   */
  async remove(instanceId: string): Promise<void> {
    await this.runtime.withStoppedSources(
      instanceId,
      ['mofox', 'platform'],
      async () => {
        const instance = await this.find(instanceId);
        const instances = await this.repository.list();
        const roots = await deletionRoots(instance, instances);
        const staged: Array<{ original: string; temporary: string }> = [];
        try {
          // 先在同一文件系统内改名隔离。仓库写入失败时仍能无损改名回来。
          for (const original of roots) {
            if (!(await pathExists(original))) continue;
            const temporary = join(
              dirname(original),
              `.${basename(original)}.neo-mofox-delete-${randomUUID()}`,
            );
            await rename(original, temporary);
            staged.push({ original, temporary });
          }
          await this.repository.remove(instanceId);
        } catch (error) {
          for (const entry of [...staged].reverse()) {
            await rename(entry.temporary, entry.original).catch(() => undefined);
          }
          throw error;
        }

        // 记录提交后再物理删除；失败时隔离目录仍保留在原路径旁，不会误删其他实例数据。
        for (const entry of staged) await this.removePath(entry.temporary);
        this.runtime.clearLogs(instanceId);
      },
      false,
    );
  }

  /**
   * 在系统文件管理器中打开 MoFox 本体安装目录。
   *
   * @param instanceId - 实例 ID。
   */
  async openFolder(instanceId: string): Promise<void> {
    const instance = await this.find(instanceId);
    await this.openPath(instance.mofoxInstallDir);
  }

  /**
   * 更新实例的可编辑配置字段并返回持久化后的最新实例。
   *
   * 更新前先核验本次改动涉及的路径：主程序目录必须存在且含 main.py；
   * 平台目录存在时按所选平台解析启动入口，确保改动后的配置仍可被运行时启动。
   *
   * @param instanceId - 实例 ID。
   * @param patch - 需要更新的字段；省略的字段保持原值。
   * @returns 更新后的实例记录。
   */
  async update(instanceId: string, patch: EditableInstancePatch): Promise<Instance> {
    const changesPaths =
      patch.mofoxInstallDir !== undefined ||
      patch.venvDir !== undefined ||
      patch.platform !== undefined;
    return this.runtime.withStoppedSources(
      instanceId,
      changesPaths ? ['mofox', 'platform'] : [],
      () => this.updateUnlocked(instanceId, patch),
    );
  }

  private async updateUnlocked(
    instanceId: string,
    patch: EditableInstancePatch,
  ): Promise<Instance> {
    let validated = patch;
    if (patch.mofoxInstallDir !== undefined && patch.mofoxInstallDir.trim()) {
      const mofoxInstallDir = await requireDirectory(patch.mofoxInstallDir, '主程序路径');
      await requireFile(
        join(mofoxInstallDir, 'main.py'),
        '所选目录不是有效的 Neo-MoFox 安装目录（缺少 main.py）',
      );
      validated = { ...validated, mofoxInstallDir };
    }
    if (patch.venvDir !== undefined && patch.venvDir.trim()) {
      const venvDir = await requireVenvDir(patch.venvDir, '虚拟环境路径');
      validated = { ...validated, venvDir };
    } else if (patch.venvDir !== undefined) {
      // 显式传入空字符串时视为跟随主程序目录的默认 .venv。
      const current = await this.find(instanceId);
      validated = {
        ...validated,
        venvDir: inferVenvDir('', patch.mofoxInstallDir ?? current.mofoxInstallDir),
      };
    }
    if (patch.platform && patch.platform.id && patch.platform.installDir) {
      const platformDir = await requireDirectory(patch.platform.installDir, '平台安装目录');
      const platform = this.platforms.get(patch.platform.id);
      try {
        await platform.getStartCommand(platformDir);
      } catch {
        throw new MofoxError('INVALID_ARGUMENT', `所选目录不是有效的 ${platform.name} 安装目录`);
      }
      validated = { ...validated, platform: { ...patch.platform, installDir: platformDir } };
    }
    return this.repository.update(instanceId, validated);
  }

  /**
   * 按 ID 从仓库查找实例，空 ID 或不存在时抛错。
   *
   * @param instanceId - 实例 ID。
   * @returns 匹配的实例记录。
   * @throws {MofoxError} 空 ID 抛 `INVALID_ARGUMENT`；未找到抛 `NOT_FOUND`。
   */
  private async find(instanceId: string): Promise<Instance> {
    if (!instanceId.trim()) throw new MofoxError('INVALID_ARGUMENT', 'Instance ID is required');
    const instance = (await this.repository.list()).find(
      (candidate) => candidate.id === instanceId,
    );
    if (!instance) throw new MofoxError('NOT_FOUND', `未知实例: ${instanceId}`);
    return instance;
  }
}

/**
 * 计算当前实例独占且互不重叠的删除根目录。
 *
 * 手动导入的平台目录可能位于 MoFox 目录之外，也可能被其他实例共享；共享目录不会删除，
 * 子目录已被某个待删父目录覆盖时也不会重复处理。
 */
async function deletionRoots(instance: Instance, all: readonly Instance[]): Promise<string[]> {
  const candidates = [instance.mofoxInstallDir, instance.platform.installDir ?? '']
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => resolve(path));
  for (const candidate of candidates) {
    if (
      candidate === dirname(candidate) ||
      samePath(candidate, homedir()) ||
      samePath(candidate, process.cwd())
    ) {
      throw new MofoxError('INVALID_ARGUMENT', `拒绝删除受保护的目录：${candidate}`);
    }
    const info = await lstat(candidate).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
        return undefined;
      throw error;
    });
    if (info?.isSymbolicLink())
      throw new MofoxError('INVALID_ARGUMENT', `请先解除实例的链接目录：${candidate}`);
  }
  const canonicalCandidates = await Promise.all(candidates.map(canonicalPath));
  const otherPaths = await Promise.all(
    all
      .filter((candidate) => candidate.id !== instance.id)
      .flatMap((candidate) => [
        candidate.mofoxInstallDir,
        candidate.venvDir,
        candidate.platform.installDir ?? '',
      ])
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => canonicalPath(resolve(path))),
  );
  const exclusive = candidates.filter(
    (_candidate, index) =>
      !otherPaths.some(
        (other) =>
          isInside(canonicalCandidates[index], other) ||
          isInside(other, canonicalCandidates[index]),
      ),
  );
  const roots: string[] = [];
  for (const candidate of [...new Set(exclusive)].sort((a, b) => a.length - b.length)) {
    if (!roots.some((root) => isInside(root, candidate))) roots.push(candidate);
  }
  return roots;
}

async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
    : left === right;
}

function isInside(parent: string, candidate: string): boolean {
  if (samePath(parent, candidate)) return true;
  const value = relative(parent, candidate);
  return (
    value !== '..' &&
    !value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(value)
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
