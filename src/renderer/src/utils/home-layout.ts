/**
 * 主页小部件的行布局分组工具。
 *
 * 「半宽」部件按顺序两两并排成行，「全宽」部件独占一行；行尾落单的
 * 半宽部件仍占满整行。布局仅依赖部件跨度，保持纯函数以便测试。
 */

/** 部件在行布局中的跨度。 */
export type WidgetSpan = 'half' | 'full';

/** 参与布局分组的最小部件描述。 */
export interface SpannedWidget {
  id: string;
  span: WidgetSpan;
}

/** 一行部件；`single` 为 true 时该行只有一个部件并占满整行。 */
export interface HomeWidgetRowLayout<T extends SpannedWidget> {
  items: T[];
  single: boolean;
}

/**
 * 将有序部件列表分组为行布局。
 *
 * @param widgets - 按展示顺序排列的部件描述。
 * @returns 行列表；相邻的半宽部件合并为同一行，其余独占一行。
 */
export function groupWidgetRows<T extends SpannedWidget>(
  widgets: readonly T[],
): Array<HomeWidgetRowLayout<T>> {
  const rows: Array<HomeWidgetRowLayout<T>> = [];
  let pending: T[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    rows.push({ items: pending, single: pending.length === 1 });
    pending = [];
  };
  for (const widget of widgets) {
    if (widget.span === 'half') {
      pending.push(widget);
      if (pending.length === 2) flush();
    } else {
      flush();
      rows.push({ items: [widget], single: true });
    }
  }
  flush();
  return rows;
}
