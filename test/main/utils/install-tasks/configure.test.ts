import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import type { InstallRequest } from '../../../../src/shared/domain/install';
import { configureInstance } from '../../../../src/main/utils/install-tasks/configure';
import type { InstallTaskContext } from '../../../../src/main/utils/install-tasks';

/** 覆盖配置任务对 core.toml 与 model.toml 的写入；平台与适配器配置委托给平台自身。 */
const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('configureInstance', () => {
  it('writes owner and api key into MoFox config files', async () => {
    const root = await createTempRoot();
    const mofoxConfig = join(root, 'mofox', 'config');
    await mkdir(mofoxConfig, { recursive: true });
    await writeFile(
      join(mofoxConfig, 'core.toml'),
      '[permissions]\nowner_list = []\n\n[http_router]\nenable_http_router = false\napi_keys = []\n',
    );
    await writeFile(
      join(mofoxConfig, 'model.toml'),
      '[[api_providers]]\nname = "SiliconFlow"\napi_key = "your-siliconflow-api-key-here"\n',
    );

    const request = sampleRequest({ platformId: '' });
    await configureInstance(createContext(root, request));

    const core = parseToml(await readFile(join(mofoxConfig, 'core.toml'), 'utf8')) as any;
    expect(core.permissions.owner_list).toEqual(['qq:98765432101']);
    expect(core.http_router.enable_http_router).toBe(true);
    expect(core.http_router.api_keys).toEqual(['abcdefgh']);

    const model = parseToml(await readFile(join(mofoxConfig, 'model.toml'), 'utf8')) as any;
    expect(model.api_providers[0].api_key).toBe('sk-test-1234');
  });

  it('creates the model provider when model.toml is missing', async () => {
    const root = await createTempRoot();
    const mofoxConfig = join(root, 'mofox', 'config');
    await mkdir(mofoxConfig, { recursive: true });
    await writeFile(join(mofoxConfig, 'core.toml'), '[permissions]\nowner_list = []\n');

    await configureInstance(createContext(root, sampleRequest({ platformId: '' })));

    const model = parseToml(await readFile(join(mofoxConfig, 'model.toml'), 'utf8')) as any;
    expect(model.api_providers[0].api_key).toBe('sk-test-1234');
    expect(model.api_providers[0].name).toBe('SiliconFlow');
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'mofox-configure-test-'));
  temporaryDirectories.push(path);
  return path;
}

function sampleRequest(overrides: Partial<InstallRequest> = {}): InstallRequest {
  return {
    instanceName: 'Test',
    platformId: 'napcat',
    mofoxBranch: 'main',
    wsPort: 8095,
    botQQ: '12345678901',
    botNickname: '灵语雪',
    ownerQQ: '98765432101',
    apiKey: 'sk-test-1234',
    installWebui: true,
    webuiApiKey: 'abcdefgh',
    targetDir: '/tmp/target',
    ...overrides,
  };
}

function createContext(stageDir: string, request: InstallRequest): InstallTaskContext {
  return {
    request,
    stageDir,
    mirrors: [],
    signal: new AbortController().signal,
    log: vi.fn(),
    progress: vi.fn(),
  };
}
