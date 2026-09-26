import { computed } from 'vue';
import type { HomeSettings, HomeWidgetId, HomeWidgetState } from '@shared/domain/home';
import { DEFAULT_HOME_SETTINGS } from '@shared/domain/home';
import { useSettingsStore } from '@/stores/settings';
import { groupWidgetRows, type WidgetSpan } from '@/utils/home-layout';
import { HOME_WIDGET_DEFINITIONS, type HomeWidgetDefinition } from '@/components/home/registry';

/**
 * 主页小部件布局的派生状态与更新入口。
 *
 * 全部修改都以「整份 home 设置补丁」提交，持久化与规范化由设置仓库与
 * 主进程统一处理；此处只负责派生启用列表、行布局与常用变更操作。
 */

/** 挂载了部件定义的渲染条目。 */
export interface HomeWidgetItem {
  state: HomeWidgetState;
  definition: HomeWidgetDefinition;
}

/** 一行待渲染的部件。 */
export interface HomeWidgetRow {
  items: HomeWidgetItem[];
  /** 行内只有一个部件时为 true，该行占满整行宽度。 */
  single: boolean;
}

/** 参与布局分组的部件跨度描述。 */
interface SpannedHomeWidget {
  id: HomeWidgetId;
  span: WidgetSpan;
}

/**
 * 访问主页布局状态与更新方法。
 *
 * @returns 布局列表、行分组结果与常用更新操作。
 */
export function useHomeWidgets() {
  const settingsStore = useSettingsStore();

  const home = computed<HomeSettings>(() => settingsStore.settings.home ?? DEFAULT_HOME_SETTINGS);

  /** 全部部件（含未启用），按当前展示顺序排列。 */
  const widgets = computed<HomeWidgetState[]>(() => home.value.widgets);

  /** 已启用且能解析到定义的部件，按展示顺序排列。 */
  const enabledItems = computed<HomeWidgetItem[]>(() =>
    home.value.widgets
      .filter((widget) => widget.enabled)
      .map((widget) => {
        const definition = HOME_WIDGET_DEFINITIONS.find((entry) => entry.id === widget.id);
        return definition ? { state: widget, definition } : null;
      })
      .filter((item): item is HomeWidgetItem => item !== null),
  );

  /** 行布局：相邻半宽部件并排，全宽部件独占一行。 */
  const rows = computed<HomeWidgetRow[]>(() => {
    const spanned: SpannedHomeWidget[] = enabledItems.value.map((item) => ({
      id: item.state.id,
      span: item.definition.span,
    }));
    const grouped = groupWidgetRows(spanned);
    const byId = new Map(enabledItems.value.map((item) => [item.state.id, item]));
    return grouped.map((row) => ({
      single: row.single,
      items: row.items.map((entry) => byId.get(entry.id)).filter((item) => item !== undefined),
    }));
  });

  /** 用新的部件列表整份提交主页设置。 */
  function commit(widgets: HomeWidgetState[]): void {
    void settingsStore.update({ home: { version: 1, widgets } });
  }

  /**
   * 更新单个部件的启用状态或配置。
   *
   * @param id - 部件 ID。
   * @param patch - 启用状态与/或配置的局部覆盖。
   */
  function updateWidget(
    id: HomeWidgetId,
    patch: { enabled?: boolean; config?: Record<string, unknown> },
  ): void {
    commit(
      home.value.widgets.map((widget) =>
        widget.id === id ? ({ ...widget, ...patch } as HomeWidgetState) : widget,
      ),
    );
  }

  /**
   * 在布局中上移或下移单个部件。
   *
   * @param id - 部件 ID。
   * @param direction - `-1` 上移，`1` 下移。
   */
  function moveWidget(id: HomeWidgetId, direction: -1 | 1): void {
    const list = [...home.value.widgets];
    const index = list.findIndex((widget) => widget.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const moved = list[index]!;
    list[index] = list[target]!;
    list[target] = moved;
    commit(list);
  }

  /** 恢复默认布局：重置顺序、开关与全部部件配置。 */
  function resetHomeLayout(): void {
    commit(
      DEFAULT_HOME_SETTINGS.widgets.map((widget) => ({
        ...widget,
        config: structuredClone(widget.config),
      })) as HomeWidgetState[],
    );
  }

  return { home, widgets, enabledItems, rows, updateWidget, moveWidget, resetHomeLayout };
}
