import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NapCatPlatform } from '../../../src/main/platforms/napcat/runtime';
import { SnowLumaPlatform } from '../../../src/main/platforms/snowluma/runtime';

const temporaryDirectories: string[] = [];

// 每个用例后递归清理临时根目录。
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('platform runtime paths (v2)', () => {
  // v2 起平台路径是唯一来源：getStartCommand 直接使用传入的 platformPath，
  // 不再回退到 dirname(installPath)/<platformId> 兄弟目录。
  it('NapCat launches directly from the given platform path without sibling fallback', async () => {
    const root = await createRoot();
    const napcat = join(root, 'napcat');
    const unrelated = join(root, 'snowluma');
    await mkdir(napcat);
    await mkdir(unrelated);
    await writeFile(join(napcat, 'node.exe'), '');
    await writeFile(join(napcat, 'index.js'), '');

    await expect(new NapCatPlatform().getStartCommand(napcat, '123')).resolves.toEqual({
      command: join(napcat, 'node.exe'),
      args: [join(napcat, 'index.js'), '-q', '123'],
      cwd: napcat,
    });
  });

  it('NapCat throws NOT_FOUND when the platform path lacks entry files, even if a sibling has them', async () => {
    const root = await createRoot();
    const empty = join(root, 'empty');
    const sibling = join(root, 'napcat');
    await mkdir(empty);
    await mkdir(sibling);
    await writeFile(join(sibling, 'node.exe'), '');
    await writeFile(join(sibling, 'index.js'), '');

    // v2 不再回退到兄弟目录；空路径直接抛 NOT_FOUND。
    await expect(new NapCatPlatform().getStartCommand(empty, '123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('SnowLuma launches directly from the given platform path without sibling fallback', async () => {
    const root = await createRoot();
    const snowluma = join(root, 'snowluma');
    await mkdir(snowluma);
    await writeFile(join(snowluma, 'index.mjs'), '');

    const command = await new SnowLumaPlatform().getStartCommand(snowluma, '123');
    expect(command.cwd).toBe(snowluma);
    expect(command.args).toEqual([join(snowluma, 'index.mjs')]);
  });

  it('SnowLuma throws NOT_FOUND when the platform path lacks entry files', async () => {
    const root = await createRoot();
    const empty = join(root, 'empty');
    await mkdir(empty);

    await expect(new SnowLumaPlatform().getStartCommand(empty, '123')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mofox-runtime-path-'));
  temporaryDirectories.push(root);
  return root;
}
