import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerMigrationIpc } from '../../../src/main/ipc/migration';

/** 验证迁移三通道的注册、参数转发、入参拒绝及服务异常的稳定序列化。 */
interface IpcMainRegistrar {
  handle(channel: string, handler: (...args: unknown[]) => unknown): unknown;
}

function createServices() {
  return {
    detect: vi.fn(async () => ({
      dataDirectory: '/legacy',
      instanceCount: 3,
      modifiedAt: 123,
    })),
    preview: vi.fn(async () => ({
      legacy: { dataDirectory: '/legacy', instanceCount: 3, modifiedAt: 123 },
      previews: [],
    })),
    importInstances: vi.fn(async () => ({ imported: 2, skipped: 1, total: 3 })),
  };
}

function createIpcMain(): { handlers: Map<string, (...args: unknown[]) => unknown>; ipcMain: IpcMainRegistrar } {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain: IpcMainRegistrar = {
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
  };
  return { handlers, ipcMain };
}

describe('registerMigrationIpc', () => {
  it('registers the three migration channels', () => {
    const { handlers, ipcMain } = createIpcMain();
    registerMigrationIpc(ipcMain, createServices());

    expect([...handlers.keys()]).toEqual([
      IPC_INVOKE_CHANNELS.detectLegacyLauncher,
      IPC_INVOKE_CHANNELS.previewLegacyMigration,
      IPC_INVOKE_CHANNELS.importLegacyMigration,
    ]);
  });

  it('forwards detect/preview/import to the service without arguments', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const services = createServices();
    registerMigrationIpc(ipcMain, services);

    const detected = await handlers.get(IPC_INVOKE_CHANNELS.detectLegacyLauncher)?.({});
    const previewed = await handlers.get(IPC_INVOKE_CHANNELS.previewLegacyMigration)?.({});
    const imported = await handlers.get(IPC_INVOKE_CHANNELS.importLegacyMigration)?.({});

    expect(services.detect).toHaveBeenCalledWith();
    expect(services.preview).toHaveBeenCalledWith();
    expect(services.importInstances).toHaveBeenCalledWith();
    expect(detected).toEqual({ dataDirectory: '/legacy', instanceCount: 3, modifiedAt: 123 });
    expect(previewed).toEqual(expect.objectContaining({ legacy: expect.any(Object) }));
    expect(imported).toEqual({ imported: 2, skipped: 1, total: 3 });
  });

  it('rejects any payload passed to migration channels', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const services = createServices();
    registerMigrationIpc(ipcMain, services);

    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.detectLegacyLauncher)?.({}, 'unexpected'),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.previewLegacyMigration)?.({}, { any: 'thing' }),
    ).rejects.toThrow('MOFOX_ERROR:');
    await expect(
      handlers.get(IPC_INVOKE_CHANNELS.importLegacyMigration)?.({}, null),
    ).rejects.toThrow('MOFOX_ERROR:');
    expect(services.detect).not.toHaveBeenCalled();
    expect(services.preview).not.toHaveBeenCalled();
    expect(services.importInstances).not.toHaveBeenCalled();
  });

  it('serializes service failures into stable IPC errors', async () => {
    const { handlers, ipcMain } = createIpcMain();
    const services = createServices();
    // 业务错误（NOT_FOUND）应保留错误码并以前缀形式回传。
    services.preview.mockRejectedValueOnce(
      Object.assign(new Error('未找到旧启动器数据'), { code: 'NOT_FOUND' }),
    );
    registerMigrationIpc(ipcMain, services);

    await expect(handlers.get(IPC_INVOKE_CHANNELS.previewLegacyMigration)?.({})).rejects.toThrow(
      'MOFOX_ERROR:',
    );
  });
});
