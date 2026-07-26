import { createReadStream } from 'node:fs';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import extractZip from 'extract-zip';
import type { InstallContext, InstallResult } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import { downloadRange } from '../utils/range-downloader';
import { runOneShot } from '../utils/process-service';

interface ReleaseAsset { name: string; browser_download_url: string; digest?: string; }
interface Release { tag_name: string; assets: ReleaseAsset[]; }

export async function installGithubRelease(
  context: InstallContext,
  repository: string,
  selectAsset: (release: Release) => ReleaseAsset | undefined,
  isRoot: (path: string) => Promise<boolean>,
): Promise<InstallResult> {
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
    const actual = await sha256(archive);
    if (actual !== asset.digest.slice(7).toLowerCase()) {
      throw new MofoxError('IO_ERROR', `${asset.name} SHA-256 校验失败`);
    }
  }

  if (asset.name.endsWith('.zip')) await extractZip(archive, { dir: payload });
  else if (asset.name.endsWith('.tar.gz')) {
    const result = await runOneShot('tar', ['-xzf', archive, '-C', payload], { timeoutMs: 120_000 });
    if (result.exitCode !== 0) throw new MofoxError('IO_ERROR', `解压失败: ${result.stderr}`);
  } else throw new MofoxError('UNAVAILABLE', `不支持的压缩包格式: ${asset.name}`);
  await rm(archive, { force: true });

  for (const candidate of [payload, ...(await childDirectories(payload)).map((name) => join(payload, name))]) {
    if (await isRoot(candidate)) return { version: release.tag_name, installPath: candidate };
  }
  throw new MofoxError('IO_ERROR', `${asset.name} 解压后的目录结构无效`);
}

export async function hasFiles(root: string, names: string[]): Promise<boolean> {
  return (await Promise.all(names.map((name) => access(join(root, name)).then(() => true, () => false)))).every(Boolean);
}

async function childDirectories(path: string): Promise<string[]> {
  try { return await readdir(path); } catch { return []; }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}