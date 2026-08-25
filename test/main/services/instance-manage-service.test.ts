import { describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../../src/shared/domain/instance';
import { InstanceManageService } from '../../../src/main/services/instance-manage-service';

/** 覆盖删除前停机、目录/记录回收、缓冲清理、打开安装目录与更新配置。 */
describe('InstanceManageService', () => {
  it('stops, removes the directory and record, then clears logs', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const runtime = { stop: vi.fn(async () => undefined), clearLogs: vi.fn() };
    const removePath = vi.fn(async () => undefined);
    const service = new InstanceManageService(runtime, repository, removePath, vi.fn(async () => undefined));

    await service.remove('one');

    expect(runtime.stop).toHaveBeenCalledWith('one');
    expect(removePath).toHaveBeenCalledWith(instance.mofoxInstallDir);
    expect(repository.remove).toHaveBeenCalledWith('one');
    expect(runtime.clearLogs).toHaveBeenCalledWith('one');
  });

  it('opens the MoFox install directory in the file manager', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    const openPath = vi.fn(async () => undefined);
    const service = new InstanceManageService({ stop: vi.fn(), clearLogs: vi.fn() }, repository, vi.fn(async () => undefined), openPath);

    await service.openFolder('one');

    expect(openPath).toHaveBeenCalledWith(instance.mofoxInstallDir);
  });

  it('forwards update patches to the repository', async () => {
    const instance = createInstance();
    const repository = createRepository(instance);
    repository.update.mockResolvedValue({ ...instance, name: 'Renamed' });
    const service = new InstanceManageService({ stop: vi.fn(), clearLogs: vi.fn() }, repository, vi.fn(async () => undefined), vi.fn(async () => undefined));

    const updated = await service.update('one', { name: 'Renamed' });

    expect(repository.update).toHaveBeenCalledWith('one', { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
  });
});

function createInstance(): Instance {
  return {
    id: 'one',
    name: 'One',
    mofoxInstallDir: 'D:\\Bot',
    platform: { id: 'test', installDir: 'D:\\Bot', version: '1' },
    status: 'stopped',
    createdAt: 1,
    lastStartedAt: null,
    autoStart: false,
  };
}

function createRepository(instance: Instance) {
  return {
    list: vi.fn(async () => [instance]),
    remove: vi.fn(async () => undefined),
    update: vi.fn(async () => instance),
  };
}
