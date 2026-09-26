// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useHomeGeometryStore } from '../../../../src/renderer/src/stores/home-geometry';
import { HOME_LAYOUT_KEY } from '../../../../src/renderer/src/utils/home-layout';
describe('home geometry persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });
  it('survives restart and preserves a solo right-hand tall widget', () => {
    const store = useHomeGeometryStore();
    store.save({
      ...store.geometry,
      clock: { span: 'half', height: 'tall', solo: true, side: 'right' },
    });
    setActivePinia(createPinia());
    expect(useHomeGeometryStore().geometry.clock).toEqual({
      span: 'half',
      height: 'tall',
      solo: true,
      side: 'right',
    });
  });
  it('recovers malformed stored data', () => {
    localStorage.setItem(HOME_LAYOUT_KEY, '{');
    expect(useHomeGeometryStore().geometry.clock?.height).toBe('half');
  });
  it('does not apply a new layout when storage fails', () => {
    const store = useHomeGeometryStore();
    const previous = JSON.stringify(store.geometry);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage full');
    });
    expect(() => store.save({})).toThrow('Storage full');
    expect(JSON.stringify(store.geometry)).toBe(previous);
  });
});
