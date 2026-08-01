import { describe, expect, it } from 'vitest';
import type { MofoxApi } from '@shared/ipc';
import { resolveMofoxApi } from '../../../../src/renderer/src/services/api-resolver';

describe('resolveMofoxApi', () => {
  const bridge = {} as MofoxApi;
  const mock = {} as MofoxApi;

  it('always prefers the real preload bridge', () => {
    expect(resolveMofoxApi(bridge, false, mock)).toBe(bridge);
  });

  it('allows the mock only under the explicit demo flag', () => {
    expect(resolveMofoxApi(undefined, true, mock)).toBe(mock);
  });

  it('fails clearly when a normal runtime has no preload bridge', () => {
    expect(() => resolveMofoxApi(undefined, false, mock)).toThrowError(
      'MoFox preload bridge is unavailable',
    );
  });
});