import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstallContext } from '../../../shared/domain/bot-platform';
import { MofoxError } from '../../../shared/domain/error';
import type { InstallTaskContext, PlatformInstallResult } from './types';

/**
 * 安装平台适配器：委托平台自身安装器下载并解压，再把结果目录收敛到 `stageDir/platform`。
 *
 * 平台安装器在 `stageDir/.platform-work` 内下载解压，成功后把确认的根目录移动为
 * `stageDir/platform`，保证后续配置任务使用统一的目录约定。
 *
 * @param ctx - 安装任务上下文；`platform` 由主服务按请求解析并注入。
 * @returns 平台发行版本号，供注册实例时回填。
 * @throws {MofoxError} 未解析到平台或平台安装失败时抛出。
 */
export async function installPlatform(ctx: InstallTaskContext): Promise<PlatformInstallResult> {
  if (!ctx.platform) {
    throw new MofoxError('NOT_FOUND', `未知平台: ${ctx.request.platformId}`);
  }
  const work = join(ctx.stageDir, '.platform-work');
  await mkdir(work, { recursive: true });
  ctx.progress('正在下载平台适配器...', 0.2);

  const installContext: InstallContext = {
    instanceId: ctx.request.instanceName,
    version: 'latest',
    workDir: work,
    targetDir: join(ctx.stageDir, 'platform'),
    mirrors: ctx.mirrors,
    signal: ctx.signal,
  };
  const result = await ctx.platform.install(installContext);

  ctx.progress('正在整理平台目录...', 0.9);
  await moveTo(ctx.stageDir, result.installPath);
  await rm(work, { recursive: true, force: true }).catch(() => undefined);
  ctx.progress('平台适配器安装完成', 1);
  return { version: result.version };
}

/**
 * 把平台安装产物移动为 `stageDir/platform`；跨设备时回退为复制。
 *
 * @param stageDir - 当前步骤目录。
 * @param installPath - 平台安装器确认的根目录。
 */
async function moveTo(stageDir: string, installPath: string): Promise<void> {
  const target = join(stageDir, 'platform');
  try {
    await rename(installPath, target);
  } catch (error) {
    if (!isCrossDevice(error)) throw error;
    const { cp } = await import('node:fs/promises');
    await cp(installPath, target, { recursive: true, force: true });
    await rm(installPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 判断错误是否为跨设备重命名（EXDEV）错误。 */
function isCrossDevice(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EXDEV';
}
