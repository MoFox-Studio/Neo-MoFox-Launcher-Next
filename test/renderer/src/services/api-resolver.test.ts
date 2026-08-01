import { describe, expect, it } from 'vitest';
import type { MofoxApi } from '@shared/ipc';
import { resolveMofoxApi } from '../../../../src/renderer/src/services/api-resolver';

describe('resolveMofoxApi', () => {
  const bridge = {} as MofoxApi;
  const mock = {} as MofoxApi;

  // 真实 Electron 环境必须优先使用预加载桥接。
  it('always prefers the real preload bridge', () => {
    expect(resolveMofoxApi(bridge, false, mock)).toBe(bridge);
  });

  // 演示开关是唯一允许使用模拟 API 的条件。
  it('allows the mock only under the explicit demo flag', () => {
    expect(resolveMofoxApi(undefined, true, mock)).toBe(mock);
  });

  // 普通运行时缺少桥接需尽早暴露明确错误。
  it('fails clearly when a normal runtime has no preload bridge', () => {
    expect(() => resolveMofoxApi(undefined, false, mock)).toThrowError(
      'MoFox preload bridge is unavailable',
    );
  });
});
