import { describe, expect, it } from 'vitest';
import { groupWidgetRows, type SpannedWidget } from '../../../../src/renderer/src/utils/home-layout';

/** 主页行布局分组：相邻半宽并排成行，全宽独占一行，行尾落单占满整行。 */
describe('groupWidgetRows', () => {
  const spanned = (id: string, span: SpannedWidget['span']): SpannedWidget => ({ id, span });

  it('pairs consecutive half widgets and isolates full widgets', () => {
    const rows = groupWidgetRows([
      spanned('clock', 'half'),
      spanned('quotes', 'half'),
      spanned('metrics', 'full'),
      spanned('docs', 'half'),
    ]);
    expect(rows).toEqual([
      { items: [spanned('clock', 'half'), spanned('quotes', 'half')], single: false },
      { items: [spanned('metrics', 'full')], single: true },
      { items: [spanned('docs', 'half')], single: true },
    ]);
  });

  it('returns no rows for an empty list', () => {
    expect(groupWidgetRows([])).toEqual([]);
  });

  it('keeps every widget when all are half width in odd counts', () => {
    const rows = groupWidgetRows([
      spanned('a', 'half'),
      spanned('b', 'half'),
      spanned('c', 'half'),
      spanned('d', 'half'),
    ]);
    expect(rows.map((row) => row.single)).toEqual([false, false]);
  });

  it('marks a single half widget row as single', () => {
    const rows = groupWidgetRows([spanned('only', 'half')]);
    expect(rows).toEqual([{ items: [spanned('only', 'half')], single: true }]);
  });
});
