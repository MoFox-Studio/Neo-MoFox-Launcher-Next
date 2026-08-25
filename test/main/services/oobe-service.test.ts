import { afterEach, describe, expect, it, vi } from 'vitest';

// 用 vi.mock 替换 utils/oobe 模块，避免触碰子进程；通过 mockResolvedValue 控制各安装器行为。
// 安装器不再实现 detect()，依赖是否已安装由 environment.detect() 统一返回的 SystemEnvInfo 决定。
vi.mock('../../../src/main/utils/oobe', () => {
  const git = {
    id: 'git',
    displayName: 'Git',
    install: vi.fn(),
  };
  const python = {
    id: 'python',
    displayName: 'Python',
    install: vi.fn(),
  };
  const uv = {
    id: 'uv',
    displayName: 'uv',
    install: vi.fn(),
  };
  return { DEPENDENCY_INSTALLERS: [git, python, uv] };
});

// platform-helper 也需要按用例控制 needsSudo 行为，简化为返回固定值。
vi.mock('../../../src/main/utils/platform-helper', () => ({
  isLinux: () => false,
  isMac: () => false,
}));

// 阻止 sudo -S -v 真实调用，直接走 mocked platform-helper 间接判定为 Windows 路径。
vi.mock('../../../src/main/utils/process-helper', () => ({
  runOneShot: vi.fn(),
}));

import { OobeService } from '../../../src/main/services/oobe-service';
import { DEPENDENCY_INSTALLERS } from '../../../src/main/utils/oobe';
import type { SystemEnvInfo } from '../../../src/shared/domain/system-env';
import type { OobeProgress } from '../../../src/shared/domain/oobe';

afterEach(() => {
  vi.clearAllMocks();
});

// vi.mock 替换后的安装器函数需要类型断言才能访问 mock 控制方法。
type MockedInstaller = {
  id: string;
  displayName: string;
  install: ReturnType<typeof vi.fn>;
};

function getMockedInstallers(): MockedInstaller[] {
  return DEPENDENCY_INSTALLERS as unknown as MockedInstaller[];
}

function createService(env?: Partial<SystemEnvInfo>) {
  const events: OobeProgress[] = [];
  const settings = { update: vi.fn(async (patch: unknown) => patch) };
  const legacy = {
    detect: vi.fn(async () => null as { dataDirectory: string; instanceCount: number; modifiedAt: number | null } | null),
  };
  const mirrors = { list: () => [] };
  const environment = {
    detect: vi.fn(async () => ({
      arch: 'x64',
      osType: 'Windows_NT',
      osRelease: '10',
      hostname: 'host',
      homedir: 'home',
      tmpdir: 'tmp',
      shell: 'shell',
      ...env,
    }) as SystemEnvInfo),
  };

  const service = new OobeService(
    { settings: settings as never, legacy: legacy as never, mirrors: mirrors as never, environment: environment as never },
    { progress: (event) => events.push(event) },
  );
  return { service, events, settings, legacy, environment };
}

describe('OobeService', () => {
  it('returns true on Windows without checking sudo', async () => {
    const { service } = createService();
    await expect(service.verifySudoPassword('')).resolves.toBe(true);
  });

  it('inspects dependencies without starting installations', async () => {
    const [git, python, uv] = getMockedInstallers();
    const { service } = createService({ gitVersion: '2.47.1' });

    const statuses = await service.inspectDependencies();

    expect(statuses.map((status) => status.status)).toEqual(['skipped', 'pending', 'pending']);
    expect(statuses[0].version).toBe('2.47.1');
    expect(git.install).not.toHaveBeenCalled();
    expect(python.install).not.toHaveBeenCalled();
    expect(uv.install).not.toHaveBeenCalled();
  });

  it('skips already-installed dependencies', async () => {
    const [git, python, uv] = getMockedInstallers();
    const { service } = createService({
      gitVersion: '2.47.1',
      pythonVersion: '3.12.8',
      uvVersion: '0.5.11',
    });

    const statuses = await service.installDependencies();

    expect(statuses.map((s) => s.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(statuses.map((s) => s.version)).toEqual(['2.47.1', '3.12.8', '0.5.11']);
    expect(git.install).not.toHaveBeenCalled();
    expect(python.install).not.toHaveBeenCalled();
    expect(uv.install).not.toHaveBeenCalled();
  });

  it('installs missing dependencies and emits progress', async () => {
    const [git, python, uv] = getMockedInstallers();
    git.install.mockResolvedValue('2.47.1');
    python.install.mockResolvedValue('3.12.8');
    uv.install.mockResolvedValue('0.5.11');

    const { service, events } = createService();
    const statuses = await service.installDependencies();

    expect(statuses.map((s) => s.status)).toEqual(['installed', 'installed', 'installed']);
    expect(statuses.map((s) => s.version)).toEqual(['2.47.1', '3.12.8', '0.5.11']);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.phase === 'installing')).toBe(true);
  });

  it('installs only dependencies not reported by environment detection', async () => {
    const [git, python, uv] = getMockedInstallers();
    python.install.mockResolvedValue('3.12.8');
    uv.install.mockResolvedValue('0.5.11');

    const { service } = createService({ gitVersion: '2.47.1' });
    const statuses = await service.installDependencies();

    expect(statuses.map((s) => s.status)).toEqual(['skipped', 'installed', 'installed']);
    expect(git.install).not.toHaveBeenCalled();
    expect(python.install).toHaveBeenCalledTimes(1);
    expect(uv.install).toHaveBeenCalledTimes(1);
  });

  it('stops on first failed dependency', async () => {
    const [git] = getMockedInstallers();
    git.install.mockRejectedValue(new Error('winget 不可用'));

    const { service } = createService();
    await expect(service.installDependencies()).rejects.toThrow('winget 不可用');
  });

  it('marks settings.oobeCompleted=true on complete', async () => {
    const { service, settings, legacy } = createService({
      gitVersion: '2.47.1',
      pythonVersion: '3.12.8',
      uvVersion: '0.5.11',
    });
    legacy.detect.mockResolvedValue({ dataDirectory: '/legacy', instanceCount: 2, modifiedAt: 1 });

    const summary = await service.complete();

    expect(summary.completed).toBe(true);
    expect(summary.dependencies).toHaveLength(3);
    expect(summary.dependencies.map((d) => d.status)).toEqual(['installed', 'installed', 'installed']);
    expect(summary.legacy?.instanceCount).toBe(2);
    expect(settings.update).toHaveBeenCalledWith({ oobeCompleted: true });
  });

  it('preserves already-resolved statuses in progress snapshots', async () => {
    // 回归测试：处理后续依赖时，进度事件中的前序依赖状态不应被回退为 `pending`。
    const { service, events } = createService({
      gitVersion: '2.47.1',
      pythonVersion: '3.12.8',
      uvVersion: '0.5.11',
    });

    await service.installDependencies();

    // 最后一条进度事件应包含全部三个依赖的最终状态，而非只有当前处理的依赖。
    const finalEvent = events[events.length - 1];
    expect(finalEvent.dependencies.map((d) => d.status)).toEqual(['skipped', 'skipped', 'skipped']);

    // 处理 python 时发出的进度事件中，git 必须保持 `skipped` 而非回退为 `pending`。
    const pythonEvent = events.find(
      (e) => e.dependencyId === 'python' || /Python/.test(e.message),
    );
    expect(pythonEvent).toBeDefined();
    const gitInPythonEvent = pythonEvent!.dependencies.find((d) => d.id === 'git');
    expect(gitInPythonEvent?.status).toBe('skipped');
  });
});
