import { describe, expect, it } from 'vitest';
import {
  defaultGeometry,
  dropWidget,
  normalizeGeometry,
  placeWidgets,
  placementStyle,
  GUTTER_ROWS,
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
    expect(result[0]).toMatchObject({ columns: 1, column: 1, height: WIDGET_HEIGHTS.full });
    expect(result[1]!.top).toBe(WIDGET_HEIGHTS.full + GUTTER_ROWS);
  });
  it('stacks two halves beside full height', () => {
    const result = placeWidgets([widget('a', 'full'), widget('b'), widget('c')]);
    expect(result.map(({ top, column }) => [top, column])).toEqual([
      [0, 1],
      [0, 2],
      [WIDGET_HEIGHTS.half, 2],
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
      expect(last.top + last.height).toBe(WIDGET_HEIGHTS.tall);
    }
  });
  it('starts a new band when the next tile would overflow', () => {
    const result = placeWidgets([widget('a', 'full'), widget('b'), widget('c', 'full')]);
    expect(result[2]).toMatchObject({ top: WIDGET_HEIGHTS.full + GUTTER_ROWS, column: 1 });
  });
  it('never fills backwards across full-width or solo barriers', () => {
    const result = placeWidgets([
      widget('a', 'tall'),
      widget('b', 'half', { span: 'full' }),
      widget('c'),
    ]);
    const bandTop = WIDGET_HEIGHTS.tall + GUTTER_ROWS;
    expect(result.map(({ top }) => top)).toEqual([
      0,
      bandTop,
      bandTop + WIDGET_HEIGHTS.half + GUTTER_ROWS,
    ]);
  });
  it('supports a right-hand anchor', () => {
    const result = placeWidgets([widget('a', 'full', { side: 'right' }), widget('b'), widget('c')]);
    expect(result.map(({ column }) => column)).toEqual([2, 1, 1]);
  });
  it('returns no positions when every widget is hidden', () => {
    expect(placeWidgets([])).toEqual([]);
  });
  it('emits row spans and a unit-based height variable', () => {
    const style = placementStyle({
      widget: widget('a', 'tall'),
      top: GUTTER_ROWS,
      height: WIDGET_HEIGHTS.tall,
      column: 2,
      columns: 1,
    });
    expect(style).toEqual({
      gridColumn: '2 / span 1',
      gridRow: `${GUTTER_ROWS + 1} / span ${WIDGET_HEIGHTS.tall}`,
      '--widget-height': `calc(var(--home-row-unit, 4px) * ${WIDGET_HEIGHTS.tall})`,
    });
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

describe('drag placement', () => {
  it('joins an empty side even when the anchor used to be solo', () => {
    const next = dropWidget([widget('a', 'full', { solo: true }), widget('b')], 'b', 30, 2);
    expect(placeWidgets(next).map((p) => [p.widget.id, p.top, p.column])).toEqual([
      ['a', 0, 1],
      ['b', 0, 2],
    ]);
  });
  it('moves the anchor aside when dropping onto its column', () => {
    const next = dropWidget([widget('a', 'full'), widget('b')], 'b', 30, 1);
    expect(placeWidgets(next).map((p) => [p.widget.id, p.column])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
  it('creates a standalone right hand row at a band edge', () => {
    const next = dropWidget([widget('a'), widget('b')], 'b', 0, 2);
    const placed = placeWidgets(next);
    expect(placed[0]).toMatchObject({ widget: { id: 'b', solo: true }, column: 2 });
    expect(placed[1]!.top).toBe(WIDGET_HEIGHTS.half + GUTTER_ROWS);
  });
  it('pushes overflow out of a full stack', () => {
    const next = dropWidget(
      [widget('a', 'full'), widget('b'), widget('c'), widget('d')],
      'd',
      20,
      2,
    );
    expect(next.map((w) => w.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(placeWidgets(next).at(-1)!.top).toBe(WIDGET_HEIGHTS.full + GUTTER_ROWS);
  });
  it('makes a taller dropped tile the anchor without overlapping its neighbors', () => {
    const next = dropWidget([widget('a'), widget('b', 'tall')], 'b', 20, 2);
    expect(placeWidgets(next).map((p) => [p.widget.id, p.column, p.top])).toEqual([
      ['b', 2, 0],
      ['a', 1, 0],
    ]);
  });
  it('moves full width tiles and leaves the source unchanged', () => {
    const source = [widget('a'), widget('b', 'full', { span: 'full' }), widget('c')];
    const snapshot = JSON.stringify(source);
    expect(dropWidget(source, 'b', 0, 2).map((w) => w.id)).toEqual(['b', 'a', 'c']);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
  it('never overlaps or loses a widget for any supported size and drop column', () => {
    for (const span of ['half', 'full'] as const)
      for (const height of ['half', 'full', 'tall'] as const) {
        const source = [
          widget('a', 'tall'),
          widget('b'),
          widget('c', 'full'),
          widget('d', height, { span }),
        ];
        for (const row of [-10, 0, 20, 50, 90, 130, 160, 500])
          for (const column of [1, 2] as const) {
            const next = placeWidgets(dropWidget(source, 'd', row, column));
            expect(new Set(next.map((p) => p.widget.id)).size).toBe(source.length);
            for (let i = 0; i < next.length; i++)
              for (let j = i + 1; j < next.length; j++) {
                const a = next[i]!;
                const b = next[j]!;
                expect(
                  a.column >= b.column + b.columns ||
                    b.column >= a.column + a.columns ||
                    a.top >= b.top + b.height ||
                    b.top >= a.top + a.height,
                ).toBe(true);
              }
          }
      }
  });
});
