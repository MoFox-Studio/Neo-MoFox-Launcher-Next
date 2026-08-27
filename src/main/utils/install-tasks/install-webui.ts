import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadReleaseAsset } from '../git/github';
import type { InstallTaskContext } from './types';

// Neo-MoFox WebUI 插件的发布仓库；`.mfp` 作为发行版资产发布。
const WEBUI_REPOSITORY = 'ikun-1145141/Neo-MoFox-Webui';

/**
 * 安装 WebUI 插件：从插件发布仓库下载最新 `.mfp` 包放入 MoFox 的插件目录。
 *
 * 插件包位于 `stageDir/mofox/plugins/`，保持发行版资产原名以便插件加载器识别。
 *
 * @param ctx - 安装任务上下文。
 * @returns WebUI 插件发行版本号。
 */
export async function installWebUi(ctx: InstallTaskContext): Promise<{ version: string }> {
  const pluginsDir = join(ctx.stageDir, 'mofox', 'plugins');
  await mkdir(pluginsDir, { recursive: true });

  ctx.progress('正在获取 WebUI 插件版本...', 0.2);
  const temp = join(pluginsDir, '.webui-download.mfp');
  const { assetName, version } = await downloadReleaseAsset({
    mirrors: ctx.mirrors,
    repository: WEBUI_REPOSITORY,
    selectAsset: (release) => release.assets.find((asset) => asset.name.endsWith('.mfp')),
    destination: temp,
    signal: ctx.signal,
  });

  ctx.progress('正在安装 WebUI 插件...', 0.8);
  await rename(temp, join(pluginsDir, assetName));
  ctx.progress('WebUI 插件安装完成', 1);
  return { version };
}
