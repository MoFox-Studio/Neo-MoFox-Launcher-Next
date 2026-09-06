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

  it('reports non-blocking inspection for missing or non-absolute paths', async () => {
    const root = await createTemporaryDirectory();
    const { service } = createService();

    const missing = await service.inspect(join(root, 'nope'));
    expect(missing.exists).toBe(false);
    expect(missing.valid).toBe(false);

    const relative = await service.inspect('relative/path');
    expect(relative.absolute).toBe(false);
  });

  it('throws when inspecting an empty venv path', async () => {
    const { service } = createService();

    await expect(service.inspect('')).rejects.toThrow('虚拟环境路径不能为空');
    await expect(service.inspect('   ')).rejects.toThrow('虚拟环境路径不能为空');
  });

  it('throws when the venv directory lacks a python executable', async () => {
    const root = await createTemporaryDirectory();
    const emptyDir = join(root, 'empty');
    await mkdir(emptyDir, { recursive: true });
    const { service } = createService();

    await expect(service.inspect(emptyDir)).rejects.toThrow('未找到 Python 解释器');
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

  it('queries available versions from a pip mirror simple index', async () => {
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
      const { service, runner } = createService({
        instances: [instanceFixture('ins-1', venvDir)],
      });

      const versions = await service.queryVersions('ins-1', 'napcat');
      expect(versions).toEqual(['4.2.19', '4.2.17']);
      // 版本查询不再调用 uv，直接请求镜像 simple index。
      expect(runner).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tries the next pip mirror when the previous simple index fails', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const html =
      '<a href="/simple/napcat/napcat-4.2.19-py3-none-any.whl">napcat-4.2.19-py3-none-any.whl</a>';
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://pypi.tuna.tsinghua.edu.cn/simple/napcat/') {
        return { ok: false, status: 500, text: async () => '' } as Response;
      }
      if (url === 'https://mirrors.aliyun.com/pypi/simple/napcat/') {
        return { ok: true, status: 200, text: async () => html } as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { service } = createService({
        instances: [instanceFixture('ins-1', venvDir)],
      });

      const versions = await service.queryVersions('ins-1', 'napcat');
      expect(versions).toEqual(['4.2.19']);
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        'https://pypi.tuna.tsinghua.edu.cn/simple/napcat/',
        'https://mirrors.aliyun.com/pypi/simple/napcat/',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetches package info from a pip mirror JSON API', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const payload = {
      info: {
        name: 'napcat',
        version: '4.2.19',
        summary: 'A bot framework',
        description: '# NapCat\n\nA **fast** bot framework.',
        author: 'MoFox Studio',
        requires_python: '>=3.9',
        home_page: 'https://example.com',
        project_urls: { Documentation: 'https://example.com/docs' },
      },
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://pypi.tuna.tsinghua.edu.cn/pypi/napcat/json') {
        return { ok: true, status: 200, json: async () => payload } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { service } = createService({
        instances: [instanceFixture('ins-1', venvDir)],
      });

      const info = await service.getVenvPackageInfo('ins-1', 'napcat');
      expect(info.name).toBe('napcat');
      expect(info.version).toBe('4.2.19');
      expect(info.summary).toBe('A bot framework');
      expect(info.description).toContain('A **fast** bot framework');
      expect(info.requiresPython).toBe('>=3.9');
      expect(info.homePage).toBe('https://example.com');
      expect(info.projectUrls).toEqual({ Documentation: 'https://example.com/docs' });
      expect(info.pypiUrl).toBe('https://pypi.org/project/napcat/');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tries the next pip mirror when the previous JSON API is unavailable', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const payload = { info: { name: 'napcat', version: '4.2.19', summary: 'ok' } };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://pypi.tuna.tsinghua.edu.cn/pypi/napcat/json') {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      if (url === 'https://mirrors.aliyun.com/pypi/pypi/napcat/json') {
        return { ok: true, status: 200, json: async () => payload } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { service } = createService({
        instances: [instanceFixture('ins-1', venvDir)],
      });

      const info = await service.getVenvPackageInfo('ins-1', 'napcat');
      expect(info.summary).toBe('ok');
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        'https://pypi.tuna.tsinghua.edu.cn/pypi/napcat/json',
        'https://mirrors.aliyun.com/pypi/pypi/napcat/json',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('emits progress events while upgrading dependencies', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const progressMessages: string[] = [];
    const runner = vi.fn(async (command: string, args: readonly string[]) => {
      expect(command).toBe('uv');
      expect(args).toContain('--upgrade');
      return okResult('');
    });
    const service = new VenvService(
      {
        list: async () => [instanceFixture('ins-1', venvDir)],
        mirrors: { list: () => PIP_MIRRORS.map((m) => ({ ...m })) },
      },
      runner,
      { progress: (event) => progressMessages.push(event.message) },
    );

    const result = await service.upgrade('ins-1', 'napcat');
    expect(result.ok).toBe(true);
    expect(result.upgraded).toBe(true);
    expect(progressMessages).toContain('正在升级 napcat...');
    expect(progressMessages).toContain('已升级 napcat');
  });

  it('reports a friendly not-found message when every mirror returns 404', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 404, text: async () => '' } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { service } = createService({
        instances: [instanceFixture('ins-1', venvDir)],
      });

      await expect(service.queryVersions('ins-1', 'nonexistent-pkg')).rejects.toThrow(
        '未找到该包的可用版本，请检查包名是否正确',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports a friendly not-found message when fetching info for an unknown package', async () => {
    const root = await createTemporaryDirectory();
    const venvDir = await createVenv(root);
    const fetchMock = vi.fn(async () => {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { service } = createService({
        instances: [instanceFixture('ins-1', venvDir)],
      });

      await expect(service.getVenvPackageInfo('ins-1', 'nonexistent-pkg')).rejects.toThrow(
        '未找到 nonexistent-pkg 的包信息，请检查包名是否正确',
      );
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
