import { describe, expect, it } from 'vitest';
import {
  defaultGeometry,
  normalizeGeometry,
  placeWidgets,
  WIDGET_HEIGHTS,
  type SpannedWidget,
} from '../../../../src/renderer/src/utils/home-layout';
const widget = (
  id: string,
  height: SpannedWidget['height'] = 'half',
  extra: Partial<SpannedWidget> = {},
): SpannedWidget => ({ id, span: 'half', height, solo: false, side: 'left', ...extra });
describe('home layout', () => {
  it('uses exact half/full/tall height ratios', () => {
    expect(WIDGET_HEIGHTS.half * 2).toBe(WIDGET_HEIGHTS.full);
    expect(WIDGET_HEIGHTS.full * 1.5).toBe(WIDGET_HEIGHTS.tall);
  });
  it('keeps a single half widget half-width and allows an explicitly empty side', () => {
    const result = placeWidgets([widget('a', 'full', { solo: true }), widget('b')]);
    expect(result[0]).toMatchObject({ columns: 1, column: 1, height: 360 });
    expect(result[1]!.top).toBe(376);
  });
  it('stacks two halves beside full height', () => {
    const result = placeWidgets([widget('a', 'full'), widget('b'), widget('c')]);
    expect(result.map(({ top, column }) => [top, column])).toEqual([
      [0, 1],
      [0, 2],
      [180, 2],
    ]);
  });
  it('stacks full plus half or three halves beside tall', () => {
    for (const stack of [
      [widget('b', 'full'), widget('c')],
      [widget('b'), widget('c'), widget('d')],
    ]) {
      const result = placeWidgets([widget('a', 'tall'), ...stack]);
      const last = result.at(-1)!;
      expect(last.column).toBe(2);
      expect(last.top + last.height).toBe(540);
    }
  });
  it('starts a new band when the next tile would overflow', () => {
    const result = placeWidgets([widget('a', 'full'), widget('b'), widget('c', 'full')]);
    expect(result[2]).toMatchObject({ top: 376, column: 1 });
  });
  it('never fills backwards across full-width or solo barriers', () => {
    const result = placeWidgets([
      widget('a', 'tall'),
      widget('b', 'half', { span: 'full' }),
      widget('c'),
    ]);
    expect(result.map(({ top }) => top)).toEqual([0, 556, 752]);
  });
  it('supports a right-hand anchor', () => {
    const result = placeWidgets([widget('a', 'full', { side: 'right' }), widget('b'), widget('c')]);
    expect(result.map(({ column }) => column)).toEqual([2, 1, 1]);
  });
  it('returns no positions when every widget is hidden', () => {
    expect(placeWidgets([])).toEqual([]);
  });
  it('normalizes old, corrupt and partial geometry without retaining unknown widgets', () => {
    expect(normalizeGeometry(null, ['clock'])).toEqual({ clock: defaultGeometry('clock') });
    expect(
      normalizeGeometry(
        { clock: { height: 'huge', span: 'full', side: 'other', solo: 1 }, unknown: {} },
        ['clock'],
      ),
    ).toEqual({ clock: { ...defaultGeometry('clock'), span: 'full' } });
  });
  it('has no overlapping rectangles for all triples of sizes', () => {
    const variants = (['half', 'full', 'tall'] as const).flatMap((height) =>
      (['half', 'full'] as const).map((span) => ({ height, span })),
    );
    for (const a of variants)
      for (const b of variants)
        for (const c of variants) {
          const result = placeWidgets([
            widget('a', a.height, a),
            widget('b', b.height, b),
            widget('c', c.height, c),
          ]);
          expect(result).toHaveLength(3);
          for (let i = 0; i < result.length; i++)
            for (let j = i + 1; j < result.length; j++) {
              const first = result[i]!;
              const second = result[j]!;
              const overlapsColumn =
                first.column < second.column + second.columns &&
                second.column < first.column + first.columns;
              const overlapsHeight =
                first.top < second.top + second.height && second.top < first.top + first.height;
              expect(overlapsColumn && overlapsHeight).toBe(false);
            }
        }
  });
});
