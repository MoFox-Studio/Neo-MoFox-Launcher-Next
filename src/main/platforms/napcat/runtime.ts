import { access, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BaseBotPlatform } from '../base-platform';
import type { StartCommand } from '../../../shared/domain/bot-platform';
import type { InstallContext, InstallResult } from '../../../shared/domain/bot-platform';
import { MofoxError } from '../../../shared/domain/error';
import { hasFiles, installGithubRelease } from '../github-installer';

export class NapCatPlatform extends BaseBotPlatform {
  readonly id = 'napcat';
  readonly name = 'NapCat';
  readonly description = '基于 NapCatQQ 的 OneBot 11 平台接入。';
  readonly supportedPlatforms = ['win32'] as Array<'win32'>;
  readonly supportedArch = ['x64'] as Array<'x64'>;

  constructor() {
    super('4.2.19');
  }

  override async install(context: InstallContext): Promise<InstallResult> {
    return installGithubRelease(
      context,
      'NapNeko/NapCatQQ',
      (release) => release.assets.find((asset) => asset.name === 'NapCat.Shell.Windows.Node.zip'),
      (root) => hasFiles(root, ['node.exe', 'index.js', 'napcat.bat', 'napcat']),
    );
  }

  override async configure(): Promise<void> {}

  async getStartCommand(installPath: string, instanceId = ''): Promise<StartCommand> {
    const platformRoots = uniquePaths([installPath, join(dirname(installPath), 'napcat')]);
    const roots = (
      await Promise.all(
        platformRoots.map(async (root) => [
          root,
          ...(await childDirectories(root))
            .filter((name) => name.startsWith('NapCat') && name.includes('Shell'))
            .map((name) => join(root, name)),
        ]),
      )
    ).flat();
    for (const root of roots) {
      const batch = join(root, `start_napcat_${instanceId}.bat`);
      if (await exists(batch)) return { command: batch, args: [], cwd: root };
      const node = join(root, 'node.exe');
      const entry = join(root, 'index.js');
      if (await exists(node) && await exists(entry)) return { command: node, args: [entry, '-q', instanceId], cwd: root };
    }
    throw new MofoxError('NOT_FOUND', `未找到 NapCat 实例启动入口: ${installPath}`);
  }
}

async function childDirectories(path: string): Promise<string[]> {
  try { return await readdir(path); } catch { return []; }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}