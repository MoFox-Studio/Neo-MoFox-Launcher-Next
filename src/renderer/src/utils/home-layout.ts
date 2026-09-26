/** Renderer-only geometry shared by the dashboard and layout editor. */
export type WidgetSpan = 'half' | 'full';
export type WidgetHeight = 'half' | 'full' | 'tall';
export interface WidgetGeometry {
  span: WidgetSpan;
  height: WidgetHeight;
  solo: boolean;
  side: 'left' | 'right';
}
export interface SpannedWidget extends WidgetGeometry {
  id: string;
}
export const WIDGET_HEIGHTS: Record<WidgetHeight, number> = { half: 180, full: 360, tall: 540 };
export const HOME_LAYOUT_KEY = 'mofox.home.geometry.v1';
export type HomeGeometry = Record<string, WidgetGeometry>;

export function defaultGeometry(id: string): WidgetGeometry {
  return {
    span: ['clock', 'quotes', 'docs'].includes(id) ? 'half' : 'full',
    height: ['favorites', 'changelog', 'docs'].includes(id) ? 'full' : 'half',
    solo: false,
    side: 'left',
  };
}

export function normalizeGeometry(source: unknown, ids: readonly string[]): HomeGeometry {
  const record = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
  return Object.fromEntries(
    ids.map((id) => {
      const raw = record[id];
      const value = raw && typeof raw === 'object' ? (raw as Partial<WidgetGeometry>) : {};
      const defaults = defaultGeometry(id);
      return [
        id,
        {
          span: value.span === 'half' || value.span === 'full' ? value.span : defaults.span,
          height:
            value.height === 'half' || value.height === 'full' || value.height === 'tall'
              ? value.height
              : defaults.height,
          solo: value.solo === true,
          side: value.side === 'right' ? 'right' : 'left',
        },
      ];
    }),
  );
}

export interface WidgetPlacement<T> {
  widget: T;
  top: number;
  height: number;
  column: number;
  columns: number;
}

/** The opposite stack never exceeds its anchor. Stacked tiles touch vertically
 * so half + full fits tall exactly. Bands and columns retain a 16px gutter. */
export function placeWidgets<T extends SpannedWidget>(widgets: readonly T[]): WidgetPlacement<T>[] {
  const placed: WidgetPlacement<T>[] = [];
  let top = 0;
  for (let index = 0; index < widgets.length;) {
    const anchor = widgets[index++]!;
    const height = WIDGET_HEIGHTS[anchor.height];
    const column = anchor.side === 'right' ? 2 : 1;
    placed.push({
      widget: anchor,
      top,
      height,
      column: anchor.span === 'full' ? 1 : column,
      columns: anchor.span === 'full' ? 2 : 1,
    });
    if (anchor.span === 'half' && !anchor.solo) {
      let used = 0;
      while (index < widgets.length) {
        const next = widgets[index]!;
        const nextHeight = WIDGET_HEIGHTS[next.height];
        if (next.span === 'full' || next.solo || used + nextHeight > height) break;
        placed.push({
          widget: next,
          top: top + used,
          height: nextHeight,
          column: column === 1 ? 2 : 1,
          columns: 1,
        });
        used += nextHeight;
        index++;
      }
    }
    top += height + 16;
  }
  return placed;
}

export function placementStyle(placement: WidgetPlacement<SpannedWidget>) {
  return {
    gridColumn: `${placement.column} / span ${placement.columns}`,
    gridRow: `${placement.top + 1} / span ${placement.height}`,
    '--widget-height': `${placement.height}px`,
  };
}
