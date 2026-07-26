import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NapCatPlatform } from './napcat/runtime';
import { SnowLumaPlatform } from './snowluma/runtime';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('legacy runtime paths', () => {
  it('finds NapCat in a sibling directory when installPath points to neo-mofox', async () => {
    const root = await createRoot();
    const neoMofox = join(root, 'neo-mofox');
    const napcat = join(root, 'napcat');
    await mkdir(neoMofox);
    await mkdir(napcat);
    await writeFile(join(napcat, 'node.exe'), '');
    await writeFile(join(napcat, 'index.js'), '');

    await expect(new NapCatPlatform().getStartCommand(neoMofox, '123')).resolves.toEqual({
      command: join(napcat, 'node.exe'),
      args: [join(napcat, 'index.js'), '-q', '123'],
      cwd: napcat,
    });
  });

  it('finds SnowLuma in a sibling directory when installPath points to neo-mofox', async () => {
    const root = await createRoot();
    const neoMofox = join(root, 'neo-mofox');
    const snowluma = join(root, 'snowluma');
    await mkdir(neoMofox);
    await mkdir(snowluma);
    await writeFile(join(snowluma, 'index.mjs'), '');

    const command = await new SnowLumaPlatform().getStartCommand(neoMofox, '123');
    expect(command.cwd).toBe(snowluma);
    expect(command.args).toEqual([join(snowluma, 'index.mjs')]);
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mofox-runtime-path-'));
  temporaryDirectories.push(root);
  return root;
}