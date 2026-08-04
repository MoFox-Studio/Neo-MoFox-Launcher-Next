import { afterEach, describe, expect, it, vi } from 'vitest';

// 用 vi.mock 替换 utils/oobe 模块，避免触碰子进程；通过 mockResolvedValue 控制各安装器行为。
vi.mock('../../../src/main/utils/oobe', () => {
  const git = {
    id: 'git',
    displayName: 'Git',
    detect: vi.fn(),
    install: vi.fn(),
  };
  const python = {
    id: 'python',
    displayName: 'Python',
    detect: vi.fn(),
    install: vi.fn(),
  };
  const uv = {
    id: 'uv',
    displayName: 'uv',
    detect: vi.fn(),
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
vi.mock('../../../src/main/utils/process-service', () => ({
  runOneShot: vi.fn(),
}));

import { OobeService } from '../../../src/main/services/oobe-service';
import { DEPENDENCY_INSTALLERS } from '../../../src/main/utils/oobe';
import type { OobeProgress } from '../../../src/shared/domain/oobe';

afterEach(() => {
  vi.clearAllMocks();
});

// vi.mock 替换后的安装器函数需要类型断言才能访问 mock 控制方法。
type MockedInstaller = {
  id: string;
  displayName: string;
  detect: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
};

function getMockedInstallers(): MockedInstaller[] {
  return DEPENDENCY_INSTALLERS as unknown as MockedInstaller[];
}

function createService() {
  const events: OobeProgress[] = [];
  const settings = { update: vi.fn(async (patch: unknown) => patch) };
  const legacy = {
    detect: vi.fn(async () => null as { dataDirectory: string; instanceCount: number; modifiedAt: number | null } | null),
  };
  const mirrors = { list: () => [] };

  const service = new OobeService(
    { settings: settings as never, legacy: legacy as never, mirrors: mirrors as never },
    { progress: (event) => events.push(event) },
  );
  return { service, events, settings, legacy };
}

describe('OobeService', () => {
  it('returns true on Windows without checking sudo', async () => {
    const { service } = createService();
    await expect(service.verifySudoPassword('')).resolves.toBe(true);
  });

  it('skips already-installed dependencies', async () => {
    const [git, python, uv] = getMockedInstallers();
    git.detect.mockResolvedValue('2.47.1');
    python.detect.mockResolvedValue('3.12.8');
    uv.detect.mockResolvedValue('0.5.11');

    const { service } = createService();
    const statuses = await service.installDependencies();

    expect(statuses.map((s) => s.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(git.install).not.toHaveBeenCalled();
    expect(python.install).not.toHaveBeenCalled();
    expect(uv.install).not.toHaveBeenCalled();
  });

  it('installs missing dependencies and emits progress', async () => {
    const [git, python, uv] = getMockedInstallers();
    git.detect.mockResolvedValue(null);
    git.install.mockResolvedValue('2.47.1');
    python.detect.mockResolvedValue(null);
    python.install.mockResolvedValue('3.12.8');
    uv.detect.mockResolvedValue(null);
    uv.install.mockResolvedValue('0.5.11');

    const { service, events } = createService();
    const statuses = await service.installDependencies();

    expect(statuses.map((s) => s.status)).toEqual(['installed', 'installed', 'installed']);
    expect(statuses.map((s) => s.version)).toEqual(['2.47.1', '3.12.8', '0.5.11']);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.phase === 'installing')).toBe(true);
  });

  it('stops on first failed dependency', async () => {
    const [git] = getMockedInstallers();
    git.detect.mockResolvedValue(null);
    git.install.mockRejectedValue(new Error('winget 不可用'));

    const { service } = createService();
    await expect(service.installDependencies()).rejects.toThrow('winget 不可用');
  });

  it('marks settings.oobeCompleted=true on complete', async () => {
    const [git, python, uv] = getMockedInstallers();
    git.detect.mockResolvedValue('2.47.1');
    python.detect.mockResolvedValue('3.12.8');
    uv.detect.mockResolvedValue('0.5.11');

    const { service, settings, legacy } = createService();
    legacy.detect.mockResolvedValue({ dataDirectory: '/legacy', instanceCount: 2, modifiedAt: 1 });

    const summary = await service.complete();

    expect(summary.completed).toBe(true);
    expect(summary.dependencies).toHaveLength(3);
    expect(summary.legacy?.instanceCount).toBe(2);
    expect(settings.update).toHaveBeenCalledWith({ oobeCompleted: true });
  });

  it('preserves already-resolved statuses in progress snapshots', async () => {
    // 回归测试：处理后续依赖时，进度事件中的前序依赖状态不应被回退为 `pending`。
    const [git, python, uv] = getMockedInstallers();
    git.detect.mockResolvedValue('2.47.1');
    python.detect.mockResolvedValue('3.12.8');
    uv.detect.mockResolvedValue('0.5.11');

    const { service, events } = createService();
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
