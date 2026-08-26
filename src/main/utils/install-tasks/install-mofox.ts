import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { MofoxError } from '../../../shared/domain/error';
import { cloneRepository } from '../git/git';
import { buildSpawnEnv, findVenvPython, killProcessTree } from '../platform-helper';
import { runOneShot, spawnProcess } from '../process-helper';
import type { InstallTaskContext } from './types';

// Neo-MoFox 本体仓库；分支由用户在向导中选择（main/dev）。
const MOFOX_REPOSITORY = 'MoFox-Studio/Neo-MoFox';
/** 首次启动等待插件配置生成的超时时间（毫秒）。 */
const CONFIG_GENERATION_TIMEOUT_MS = 240_000;
/**
 * Neo-MoFox 启动前需要交互确认 EULA 与遥测隐私协议；非交互安装场景下
 * 设置该环境变量可让启动流程自动按「同意」落盘协议状态并继续生成配置。
 */
const STARTUP_AGREEMENT_ENV_VAR = 'MOFOX_ACCEPT_STARTUP_AGREEMENTS';

/**
 * 安装 MoFox 本体：克隆仓库 → uv sync → 首次启动生成配置文件。
 *
 * 产物固定位于 `stageDir/mofox`，供后续步骤（WebUI、配置）在复制后的快照上继续。
 *
 * @param ctx - 安装任务上下文。
 * @throws {MofoxError} 克隆、依赖同步或配置生成失败时抛出对应错误。
 */
export async function installMoFox(ctx: InstallTaskContext): Promise<void> {
  const repoDir = join(ctx.stageDir, 'mofox');

  ctx.progress('正在克隆 Neo-MoFox 仓库...', 0.1);
  await cloneRepository({
    mirrors: ctx.mirrors,
    repository: MOFOX_REPOSITORY,
    branch: ctx.request.mofoxBranch,
    destination: repoDir,
    signal: ctx.signal,
    onProgress: (message) => ctx.log(message),
  });

  ctx.progress('正在同步 Python 依赖 (uv sync)...', 0.45);
  const sync = await runOneShot('uv', ['sync'], {
    cwd: repoDir,
    timeoutMs: 600_000,
    env: buildSpawnEnv(),
  });
  if (sync.exitCode !== 0) {
    throw new MofoxError(
      'IO_ERROR',
      `uv sync 失败: ${sync.stderr?.trim() || `exit ${sync.exitCode}`}`,
    );
  }

  ctx.progress('正在首次启动生成配置文件...', 0.7);
  await generateConfigOnFirstRun(repoDir, ctx);

  ctx.progress('MoFox 本体安装完成', 1);
}

/**
 * 首次启动 MoFox，等待插件配置目录生成后优雅停止进程。
 *
 * 标记文件是 OneBot 适配器配置；出现即代表所有内置插件配置已落盘，
 * 之后即可安全停止进程并由配置任务编辑这些文件。
 *
 * @param repoDir - MoFox 仓库目录。
 * @param ctx - 安装任务上下文。
 * @throws {MofoxError} 取消或超时仍未生成核心配置时抛出。
 */
async function generateConfigOnFirstRun(repoDir: string, ctx: InstallTaskContext): Promise<void> {
  const venvPython = await findVenvPython(repoDir);
  const command = venvPython ?? 'uv';
  const args = venvPython ? ['main.py'] : ['run', 'main.py'];
  const child = spawnProcess(command, args, {
    cwd: repoDir,
    env: buildSpawnEnv({ [STARTUP_AGREEMENT_ENV_VAR]: '1' }),
  });
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (data: string) => ctx.log(trimLogLine(data)));
  child.stderr?.on('data', (data: string) => ctx.log(trimLogLine(data)));

  const adapterMarker = join(repoDir, 'config', 'plugins', 'onebot_adapter', 'config.toml');
  const coreMarker = join(repoDir, 'config', 'core.toml');

  try {
    const adapterReady = await waitForConfigOrProcessExit(child, adapterMarker, ctx.signal);
    if (ctx.signal.aborted) throw new MofoxError('CONFLICT', '安装已取消');
    // 超时或进程自行退出时退而求其次：只要核心配置已生成即可继续，由配置任务补齐插件配置。
    if (!adapterReady && !(await exists(coreMarker))) {
      throw new MofoxError('IO_ERROR', 'Neo-MoFox 首次启动未能生成配置文件');
    }
    ctx.log('配置文件已生成，正在停止首次启动进程...');
  } finally {
    if (child.pid) {
      await killProcessTree(child.pid, 'SIGTERM').catch(() => undefined);
      await sleep(2_000);
      await killProcessTree(child.pid, 'SIGKILL').catch(() => undefined);
    }
  }
}

/**
 * 轮询等待配置标记文件出现、进程退出或达到超时。
 *
 * @param child - 首次启动子进程。
 * @param marker - 期望出现的配置文件路径。
 * @param signal - 取消信号。
 * @param timeoutMs - 最长等待时间。
 * @returns 标记文件在窗口期内出现时返回 `true`，否则返回 `false`。
 */
function waitForConfigOrProcessExit(
  child: ChildProcess,
  marker: string,
  signal: AbortSignal,
  timeoutMs = CONFIG_GENERATION_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(ok);
    };
    const timer = setInterval(() => {
      if (signal.aborted) {
        finish(false);
        return;
      }
      void exists(marker).then((ready) => {
        if (ready) finish(true);
      });
    }, 1_500);
    timer.unref?.();
    child.once('close', () => finish(false));
    const timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
  });
}

/** 检查路径是否可访问。 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 压缩日志行首尾空白，避免大段空白行刷屏。 */
function trimLogLine(value: string): string {
  const trimmed = value.replace(/\s+$/, '');
  return trimmed.length > 0 ? trimmed : '[mofox]';
}

/** 等待指定毫秒数。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
