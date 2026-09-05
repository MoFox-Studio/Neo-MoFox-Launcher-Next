import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import type { MirrorSource } from '../../../src/shared/domain/mirror';
import type { ExecResult } from '../../../src/main/utils/process-helper';
import { VenvService } from '../../../src/main/services/venv-service';

/** 覆盖 venv 路径探测、包列表、安装、卸载、升级与版本查询，含镜像轮询降级。 */
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-venv-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const PIP_MIRRORS: readonly MirrorSource[] = [
  {
    id: 'pip-tsinghua',
    type: 'pip',
    name: '清华 PyPI',
    baseUrl: 'https://pypi.tuna.tsinghua.edu.cn/simple',
  },
  {
    id: 'pip-aliyun',
    type: 'pip',
    name: '阿里云 PyPI',
    baseUrl: 'https://mirrors.aliyun.com/pypi/simple',
  },
];

function instanceFixture(id: string, venvDir: string): Instance {
  return {
    id,
    name: `Bot ${id}`,
    mofoxInstallDir: '/bots/mofox',
    venvDir,
    platform: { id: null, installDir: null, version: null },
    status: 'stopped',
    createdAt: 1,
    lastStartedAt: null,
    autoStart: false,
  };
}

function okResult(stdout: string, exitCode = 0): ExecResult {
  return { stdout, stderr: '', exitCode, timedOut: false };
}

/** 在临时目录中构造带 Python 解释器与 pyvenv.cfg 的 venv。 */
async function createVenv(root: string, name = '.venv'): Promise<string> {
  const venvDir = join(root, name);
  const binDir = join(venvDir, 'bin');
  await mkdir(binDir, { recursive: true });
  await writeFile(join(venvDir, 'pyvenv.cfg'), 'home = /usr\n');
  await writeFile(join(binDir, 'python3'), '#!/bin/sh\n');
  return venvDir;
}

function createService(
  overrides: {
    runner?: (command: string, args: readonly string[], options?: unknown) => Promise<ExecResult>;
    instances?: Instance[];
    mirrors?: readonly MirrorSource[];
  } = {},
): { service: VenvService; runner: ReturnType<typeof vi.fn> } {
  const runner = vi.fn(overrides.runner ?? (async () => okResult('[]')));
  const service = new VenvService(
    {
      list: async () => overrides.instances ?? [instanceFixture('ins-1', '/bots/mofox/.venv')],
      mirrors: { list: () => (overrides.mirrors ?? PIP_MIRRORS).map((m) => ({ ...m })) },
    },
    runner,
  );
  return { service, runner };
}

describe('VenvService', () => {
  it('inspects a valid venv directory', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const { service } = createService();

    const result = await service.inspect(venvDir);
    expect(result).toEqual({
      absolute: true,
      exists: true,
      isDirectory: true,
      valid: true,
      pythonExists: true,
    });
  });

  it('reports missing python and invalid venv markers', async () => {
    const root = await createTemporaryDirectory();
    const emptyDir = join(root, 'empty');
    await mkdir(emptyDir, { recursive: true });
    const { service } = createService();

    const missing = await service.inspect(join(root, 'nope'));
    expect(missing.exists).toBe(false);
    expect(missing.valid).toBe(false);

    const invalid = await service.inspect(emptyDir);
    expect(invalid.exists).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.pythonExists).toBe(false);
  });

  it('lists packages from uv pip output', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const { service } = createService({
      runner: async (command, args) => {
        expect(command).toBe('uv');
        expect(args).toContain('list');
        expect(args).toContain(join(venvDir, 'bin', 'python3'));
        return okResult(
          JSON.stringify([
            { name: 'napcat', version: '4.2.19' },
            { name: 'httpx', version: '0.27.2' },
          ]),
        );
      },
      instances: [instanceFixture('ins-1', venvDir)],
    });

    const info = await service.getVenvInfo('ins-1');
    expect(info.valid).toBe(true);
    expect(info.packages).toEqual([
      { name: 'napcat', version: '4.2.19' },
      { name: 'httpx', version: '0.27.2' },
    ]);
    // 离线环境下可升级检查失败时应降级为无升级，不抛出。
    expect(info.hasUpgrades).toBe(false);
    expect(info.upgrades).toEqual([]);
  });

  it('merges outdated check results into the package summary', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    let call = 0;
    const { service } = createService({
      runner: async () => {
        call += 1;
        if (call === 1) {
          return okResult(JSON.stringify([{ name: 'napcat', version: '4.2.0' }]));
        }
        return okResult(
          JSON.stringify([{ name: 'napcat', version: '4.2.0', latest_version: '4.2.19' }]),
        );
      },
      instances: [instanceFixture('ins-1', venvDir)],
    });

    const info = await service.getVenvInfo('ins-1');
    expect(info.packages).toEqual([{ name: 'napcat', version: '4.2.0' }]);
    expect(info.hasUpgrades).toBe(true);
    expect(info.upgrades).toEqual([{ name: 'napcat', current: '4.2.0', latest: '4.2.19' }]);
  });

  it('installs a package via the first working pip mirror', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const attempts: string[] = [];
    const { service, runner } = createService({
      runner: async (_command, args) => {
        const index = args.indexOf('--index-url');
        attempts.push(String(args[index + 1]));
        // 第一个镜像（清华）返回失败，应切换到下一个镜像（阿里云）重试。
        if (attempts.length === 1) return okResult('', 1);
        return okResult('');
      },
      instances: [instanceFixture('ins-1', venvDir)],
    });

    const result = await service.install('ins-1', 'napcat', '4.2.19');
    expect(result.ok).toBe(true);
    expect(result.installed).toBe(true);
    // 第一个镜像失败后切换到第二个。
    expect(attempts).toEqual([
      'https://pypi.tuna.tsinghua.edu.cn/simple',
      'https://mirrors.aliyun.com/pypi/simple',
    ]);
    expect(runner).toHaveBeenCalled();
  });

  it('uninstalls a package', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const { service, runner } = createService({
      runner: async (command, args) => {
        expect(command).toBe('uv');
        expect(args).toContain('uninstall');
        expect(args).toContain('napcat');
        return okResult('');
      },
      instances: [instanceFixture('ins-1', venvDir)],
    });

    const result = await service.uninstall('ins-1', 'napcat');
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(true);
    expect(runner).toHaveBeenCalled();
  });

  it('upgrades a single package to the latest version', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const { service, runner } = createService({
      runner: async (command, args) => {
        expect(command).toBe('uv');
        expect(args).toContain('--upgrade');
        expect(args).toContain('napcat');
        return okResult('');
      },
      instances: [instanceFixture('ins-1', venvDir)],
    });

    const result = await service.upgrade('ins-1', 'napcat');
    expect(result.ok).toBe(true);
    expect(result.upgraded).toBe(true);
    expect(runner).toHaveBeenCalled();
  });

  it('queries available versions from a pip mirror', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const { service } = createService({
      runner: async () =>
        okResult('Resolved 3 versions\nAvailable versions:\n  4.2.17\n  4.2.18\n  4.2.19\n'),
      instances: [instanceFixture('ins-1', venvDir)],
    });

    const versions = await service.queryVersions('ins-1', 'napcat');
    expect(versions).toEqual(['4.2.19', '4.2.18', '4.2.17']);
  });

  it('falls back to the PEP 503 simple index when uv lacks the index subcommand', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const html =
      '<a href="/simple/napcat/napcat-4.2.17-py3-none-any.whl#sha256=x">napcat-4.2.17-py3-none-any.whl</a>' +
      '<a href="/simple/napcat/napcat-4.2.19-py3-none-any.whl#sha256=y">napcat-4.2.19-py3-none-any.whl</a>';
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://pypi.tuna.tsinghua.edu.cn/simple/napcat/') {
        return { ok: true, status: 200, text: async () => html } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { service } = createService({
        // 第一次 uv 调用（`pip index` 子命令缺失）返回非零退出码，触发 simple index 回退。
        runner: async (command, args) => {
          expect(command).toBe('uv');
          if (args.includes('index')) return okResult('', 2);
          return okResult('');
        },
        instances: [instanceFixture('ins-1', venvDir)],
      });

      const versions = await service.queryVersions('ins-1', 'napcat');
      expect(versions).toEqual(['4.2.19', '4.2.17']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws a readable error when the venv python is missing', async () => {
    const { service } = createService({
      instances: [instanceFixture('ins-1', '/bots/mofox/.venv')],
    });

    await expect(service.getVenvInfo('ins-1')).rejects.toThrow('虚拟环境尚未创建');
  });

  it('throws for unknown instances and blank package names', async () => {
    const { service } = createService({ instances: [] });

    await expect(service.install('nope', 'napcat')).rejects.toThrow('未知实例');
    await expect(service.install('ins-1', '  ')).rejects.toThrow('包名不能为空');
  });
});
