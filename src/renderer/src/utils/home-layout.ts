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
/** Heights are expressed in grid rows of --home-row-unit (4px by default) so the
 * whole layout scales with the viewport while keeping the 0.5 : 1 : 1.5 ratios. */
export const WIDGET_HEIGHTS: Record<WidgetHeight, number> = { half: 45, full: 90, tall: 135 };
/** Row gutter between bands, in grid rows (16px at the default 4px unit). */
export const GUTTER_ROWS = 4;
export const HOME_LAYOUT_KEY = 'mofox.home.geometry.v1';
export type HomeGeometry = Record<string, WidgetGeometry>;

export function defaultGeometry(id: string): WidgetGeometry {
  return {
    span: ['clock', 'quotes', 'docs', 'notes', 'links'].includes(id) ? 'half' : 'full',
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
 * so half + full fits tall exactly. Bands and columns retain a row gutter. */
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
    top += height + GUTTER_ROWS;
  }
  return placed;
}

export function placementStyle(placement: WidgetPlacement<SpannedWidget>) {
  return {
    gridColumn: `${placement.column} / span ${placement.columns}`,
    gridRow: `${placement.top + 1} / span ${placement.height}`,
    '--widget-height': `calc(var(--home-row-unit, 4px) * ${placement.height})`,
  };
}

/** Resolve a drop against the layout with the moving tile removed. Coordinates
 * use grid rows and a column, so viewport scaling does not change the result. */
export function dropWidget<T extends SpannedWidget>(
  widgets: readonly T[],
  id: string,
  row: number,
  column: 1 | 2,
): T[] {
  const moving = widgets.find((widget) => widget.id === id);
  if (!moving) return [...widgets];
  const rest = widgets.filter((widget) => widget.id !== id).map((widget) => ({ ...widget }));
  const placed = placeWidgets(rest);
  const tile = {
    ...moving,
    side: column === 1 ? ('left' as const) : ('right' as const),
    solo: true,
  };
  // Anchors are exactly those placements that begin a new band.
  const bands = placed.filter(
    (entry, index) =>
      index === 0 ||
      entry.top >= Math.max(...placed.slice(0, index).map((other) => other.top + other.height)),
  );
  const band = bands.find((entry) => row < entry.top + entry.height + GUTTER_ROWS / 2);
  if (!band) return [...rest, tile];
  const index = rest.findIndex((widget) => widget.id === band.widget.id);
  const edge = Math.min(10, band.height * 0.2);
  const beside =
    tile.span === 'half' &&
    band.columns === 1 &&
    row >= band.top + edge &&
    row < band.top + band.height - edge;
  if (beside) {
    tile.solo = false;
    band.widget.solo = false;
    band.widget.side = column === 1 ? 'right' : 'left';
    if (WIDGET_HEIGHTS[tile.height] >= band.height) {
      rest.splice(index, 0, tile);
    } else {
      // Insert at the pointed stack slot; displaced tiles flow into later bands.
      const stack = placed.filter(
        (entry) =>
          entry.top >= band.top &&
          entry.top < band.top + band.height &&
          entry.widget.id !== band.widget.id,
      );
      const target = stack.find((entry) => row < entry.top + entry.height / 2);
      const insertion = target
        ? rest.findIndex((widget) => widget.id === target.widget.id)
        : index + 1 + stack.length;
      rest.splice(insertion, 0, tile);
    }
  } else {
    const nextBand = bands[bands.indexOf(band) + 1];
    const after = row >= band.top + band.height / 2;
    const insertion = after
      ? nextBand
        ? rest.findIndex((widget) => widget.id === nextBand.widget.id)
        : rest.length
      : index;
    rest.splice(insertion, 0, tile);
  }
  return rest;
}
