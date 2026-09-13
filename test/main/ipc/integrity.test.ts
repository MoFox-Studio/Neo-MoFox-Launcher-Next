import { describe, expect, it, vi } from 'vitest';
import { IPC_INVOKE_CHANNELS } from '../../../src/shared/ipc';
import { registerIntegrityIpc } from '../../../src/main/ipc/integrity';

/** 验证完整性检查通道的注册与错误序列化。 */
function createActions() {
  return { check: vi.fn() };
}

describe('registerIntegrityIpc', () => {
  it('registers the integrity check channel and forwards the result', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    actions.check.mockResolvedValue([{ instanceId: 'one', name: 'One', problems: ['mofox'] }]);
    registerIntegrityIpc(ipcMain, actions);

    const handler = handlers.get(IPC_INVOKE_CHANNELS.checkInstancesIntegrity);
    const result = (await handler?.({})) as {
      instanceId: string;
      name: string;
      problems: string[];
    }[];

    expect([...handlers.keys()]).toEqual([IPC_INVOKE_CHANNELS.checkInstancesIntegrity]);
    expect(actions.check).toHaveBeenCalledOnce();
    expect(result[0]?.instanceId).toBe('one');
  });

  it('serializes service errors into the cross-process error protocol', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const actions = createActions();
    actions.check.mockRejectedValue(new Error('disk failure'));
    registerIntegrityIpc(ipcMain, actions);

    const invocation = handlers.get(IPC_INVOKE_CHANNELS.checkInstancesIntegrity)?.({});
    await expect(invocation).rejects.toThrow('MOFOX_ERROR:');
  });
});
