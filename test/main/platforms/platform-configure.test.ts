import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { NapCatPlatform } from '../../../src/main/platforms/napcat/runtime';
import { SnowLumaPlatform } from '../../../src/main/platforms/snowluma/runtime';

/** 覆盖各平台在安装后配置阶段写入 WS 端点与 OneBot 适配器端口。 */
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('platform configure', () => {
  it('NapCat writes a WS client endpoint for the bot QQ and the adapter port', async () => {
    const root = await createTempRoot();
    const platformDir = join(root, 'napcat');
    const mofoxConfigDir = join(root, 'mofox', 'config');
    await mkdir(join(mofoxConfigDir, 'plugins', 'onebot_adapter'), { recursive: true });
    await writeOnebotConfig(mofoxConfigDir);

    await new NapCatPlatform().configure('inst-1', platformDir, {
      wsPort: 9000,
      botQQ: '12345678901',
      mofoxConfigDir,
    });

    const napcat = JSON.parse(
      await readFile(join(platformDir, 'config', 'onebot11_12345678901.json'), 'utf8'),
    ) as any;
    expect(napcat.network.websocketClients).toHaveLength(1);
    expect(napcat.network.websocketClients[0]).toMatchObject({
      name: 'MoFox',
      enable: true,
      url: 'ws://127.0.0.1:9000',
      messagePostFormat: 'array',
    });

    const adapter = parseToml(
      await readFile(join(mofoxConfigDir, 'plugins', 'onebot_adapter', 'config.toml'), 'utf8'),
    ) as any;
    expect(adapter.onebot_server.port).toBe(9000);
  });

  it('SnowLuma writes a WS client endpoint for the bot QQ and the adapter port', async () => {
    const root = await createTempRoot();
    const platformDir = join(root, 'snowluma');
    const mofoxConfigDir = join(root, 'mofox', 'config');
    await mkdir(join(mofoxConfigDir, 'plugins', 'onebot_adapter'), { recursive: true });
    await writeOnebotConfig(mofoxConfigDir);

    await new SnowLumaPlatform().configure('inst-1', platformDir, {
      wsPort: 9001,
      botQQ: '22345678901',
      mofoxConfigDir,
    });

    const snowluma = JSON.parse(
      await readFile(join(platformDir, 'config', 'onebot_22345678901.json'), 'utf8'),
    ) as any;
    expect(snowluma.networks.wsClients).toHaveLength(1);
    expect(snowluma.networks.wsClients[0]).toMatchObject({
      name: 'MoFox',
      enabled: true,
      url: 'ws://127.0.0.1:9001',
      role: 'Universal',
      messageFormat: 'array',
    });

    const adapter = parseToml(
      await readFile(join(mofoxConfigDir, 'plugins', 'onebot_adapter', 'config.toml'), 'utf8'),
    ) as any;
    expect(adapter.onebot_server.port).toBe(9001);
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'mofox-platform-configure-'));
  temporaryDirectories.push(path);
  return path;
}

async function writeOnebotConfig(mofoxConfigDir: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    join(mofoxConfigDir, 'plugins', 'onebot_adapter', 'config.toml'),
    '[plugin]\nenabled = true\n\n[onebot_server]\nmode = "reverse"\nport = 8095\n',
  );
}
