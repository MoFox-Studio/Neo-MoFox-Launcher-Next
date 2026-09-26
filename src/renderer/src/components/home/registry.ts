import type { Component } from 'vue';
import type { HomeWidgetId } from '@shared/domain/home';
import WidgetChangelog from './WidgetChangelog.vue';
import WidgetClock from './WidgetClock.vue';
import WidgetDocs from './WidgetDocs.vue';
import WidgetFavorites from './WidgetFavorites.vue';
import WidgetMetrics from './WidgetMetrics.vue';
import WidgetQuickActions from './WidgetQuickActions.vue';
import WidgetQuotes from './WidgetQuotes.vue';

/**
 * 主页小部件注册表。
 *
 * 渲染层与设置面板共同消费这里声明的元数据；`span` 决定行布局中
 * 与相邻部件并排（half）还是独占一行（full），顺序即默认布局顺序。
 */
export interface HomeWidgetDefinition {
  id: HomeWidgetId;
  title: string;
  description: string;
  icon: string;
  /** half 与相邻 half 并排成行；full 独占一行。 */
  span: 'half' | 'full';
  component: Component;
}

/** 全部主页部件的定义；顺序即默认布局顺序。 */
export const HOME_WIDGET_DEFINITIONS: HomeWidgetDefinition[] = [
  {
    id: 'clock',
    title: '时钟与日期',
    description: '大号时间、日期与问候语',
    icon: 'schedule',
    span: 'half',
    component: WidgetClock,
  },
  {
    id: 'quotes',
    title: '名人名言',
    description: '来自在线一言服务的句子，支持定时轮换',
    icon: 'format_quote',
    span: 'half',
    component: WidgetQuotes,
  },
  {
    id: 'metrics',
    title: '仪表盘',
    description: '实例状态概览指标，可自选展示项',
    icon: 'monitoring',
    span: 'full',
    component: WidgetMetrics,
  },
  {
    id: 'favorites',
    title: '常用实例',
    description: '收藏的实例卡片与快捷启停',
    icon: 'favorite',
    span: 'full',
    component: WidgetFavorites,
  },
  {
    id: 'quickActions',
    title: '快捷操作',
    description: '常用功能的一键入口',
    icon: 'bolt',
    span: 'full',
    component: WidgetQuickActions,
  },
  {
    id: 'changelog',
    title: '版本更新日志',
    description: '当前构建对应发行版的更新说明',
    icon: 'history_edu',
    span: 'full',
    component: WidgetChangelog,
  },
  {
    id: 'docs',
    title: '文档',
    description: '本地与远程 Markdown 文档的阅读列表',
    icon: 'description',
    span: 'half',
    component: WidgetDocs,
  },
];
