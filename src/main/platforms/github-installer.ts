import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import extractZip from 'extract-zip';
import type { InstallContext, InstallResult } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import { downloadRange } from '../utils/range-downloader';
import { runOneShot } from '../utils/process-service';

// GitHub Release 安装流水线的最小元数据结构，仅保留选择资产与校验所需字段。
interface ReleaseAsset { name: string; browser_download_url: string; digest?: string; }
interface Release { tag_name: string; assets: ReleaseAsset[]; }

export async function installGithubRelease(
  context: InstallContext,
  repository: string,
  selectAsset: (release: Release) => ReleaseAsset | undefined,
  isRoot: (path: string) => Promise<boolean>,
): Promise<InstallResult> {
  // 依次完成发行版查询、资产选择、下载校验、解压和根目录确认；各平台仅注入差异规则。
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Neo-MoFox-Launcher' },
    signal: context.signal,
  });
  if (!response.ok) throw new MofoxError('IO_ERROR', `GitHub release 请求失败: HTTP ${response.status}`);
  const release = await response.json() as Release;
  const asset = selectAsset(release);
  if (!asset) throw new MofoxError('UNAVAILABLE', `发行版 ${release.tag_name} 没有适合当前系统的完整包`);

  const archive = join(context.workDir, basename(asset.name));
  const payload = join(context.workDir, 'payload');
  await mkdir(payload, { recursive: true });
  await downloadRange(asset.browser_download_url, archive, { signal: context.signal });
  if (asset.digest?.startsWith('sha256:')) {
    // 仅在发布元数据提供 SHA-256 时校验，失败时不允许进入解压阶段。
    const actual = await sha256(archive);
    if (actual !== asset.digest.slice(7).toLowerCase()) {
      throw new MofoxError('IO_ERROR', `${asset.name} SHA-256 校验失败`);
    }
  }

  // ZIP 由库在当前进程解压，tar.gz 交给系统 tar 并限制外部进程最长执行时间。
  if (asset.name.endsWith('.zip')) await extractZip(archive, { dir: payload });
  else if (asset.name.endsWith('.tar.gz')) {
    const result = await runOneShot('tar', ['-xzf', archive, '-C', payload], { timeoutMs: 120_000 });
    if (result.exitCode !== 0) throw new MofoxError('IO_ERROR', `解压失败: ${result.stderr}`);
  } else throw new MofoxError('UNAVAILABLE', `不支持的压缩包格式: ${asset.name}`);
  await rm(archive, { force: true });

  // Release 可能直接解出根目录，也可能额外包一层顶级目录，逐一交由平台规则确认。
  for (const candidate of [payload, ...(await childDirectories(payload)).map((name) => join(payload, name))]) {
    if (await isRoot(candidate)) return { version: release.tag_name, installPath: candidate };
  }
  throw new MofoxError('IO_ERROR', `${asset.name} 解压后的目录结构无效`);
}

export async function hasFiles(root: string, names: string[]): Promise<boolean> {
  // 必需文件的访问检查可并发进行，任一缺失即视为该目录不符合安装根定义。
  return (await Promise.all(names.map((name) => access(join(root, name)).then(() => true, () => false)))).every(Boolean);
}

async function childDirectories(path: string): Promise<string[]> {
  try { return await readdir(path); } catch { return []; }
}

async function sha256(path: string): Promise<string> {
  // 流式读取归档，避免大体积 Release 完整载入主进程内存。
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
