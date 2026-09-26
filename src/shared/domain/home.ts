/**
 * 主页小部件布局的跨进程共享类型与归一化逻辑。
 *
 * 主页由可开关、可排序的小部件组成；每个部件携带一份专属配置。
 * 布局与配置持久化在 `LauncherSettings.home`，此处是类型、默认值与
 * 校验/归一化的唯一来源，供主进程设置服务与渲染层共用。
 */

/** 主页小部件的唯一标识。 */
export type HomeWidgetId =
  | 'clock'
  | 'quotes'
  | 'metrics'
  | 'favorites'
  | 'quickActions'
  | 'changelog'
  | 'docs';

/** 时钟部件配置。 */
export interface ClockWidgetConfig {
  /** 使用 24 小时制；关闭时跟随 12 小时制。 */
  hour24: boolean;
  showDate: boolean;
  showGreeting: boolean;
}

/** 仪表盘部件可展示的指标。 */
export type HomeMetricId = 'total' | 'favorites' | 'running' | 'error' | 'platforms';

/** 依固定展示顺序排列的全部指标。 */
export const HOME_METRIC_IDS = ['total', 'favorites', 'running', 'error', 'platforms'] as const;

/** 仪表盘部件配置；`items` 中的指标按所选顺序渲染，可为空。 */
export interface MetricsWidgetConfig {
  items: HomeMetricId[];
}

/** 名言在线来源；`random` 表示每次获取时在全部来源间随机挑选。 */
export type QuoteProviderId = 'hitokoto' | 'jinrishici';
export type QuoteProviderSetting = QuoteProviderId | 'random';

/** 名言自动轮换间隔；`off` 表示仅在手动刷新时更换。 */
export type QuoteRotationInterval = 'off' | '10s' | '30s' | '1m' | '5m' | '15m';

/** 全部轮换间隔选项，供设置界面渲染。 */
export const QUOTE_ROTATION_INTERVALS = ['off', '10s', '30s', '1m', '5m', '15m'] as const;

/** 一言（hitokoto.cn）支持的句子分类，与接口的 `c` 参数一一对应。 */
export const HITOKOTO_CATEGORY_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] as const;

/** 一言分类的中文标签，供设置界面渲染。 */
export const HITOKOTO_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'a', label: '动画' },
  { id: 'b', label: '漫画' },
  { id: 'c', label: '文学' },
  { id: 'd', label: '原创' },
  { id: 'e', label: '网络' },
  { id: 'f', label: '其他' },
  { id: 'g', label: '影视' },
  { id: 'h', label: '诗词' },
  { id: 'i', label: '网易云' },
  { id: 'j', label: '哲学' },
  { id: 'k', label: '抖机灵' },
];

/** 名言部件配置。 */
export interface QuotesWidgetConfig {
  provider: QuoteProviderSetting;
  /** 一言分类过滤；空数组表示不筛选（全部分类），仅对一言来源生效。 */
  categories: string[];
  showAuthor: boolean;
  showSource: boolean;
  rotation: QuoteRotationInterval;
}

/** 快捷操作部件可展示的动作。 */
export type QuickActionId = 'add-instance' | 'manage-instances' | 'open-settings' | 'check-update';

/** 全部快捷动作，供设置界面渲染。 */
export const QUICK_ACTION_IDS = [
  'add-instance',
  'manage-instances',
  'open-settings',
  'check-update',
] as const;

/** 快捷操作部件配置。 */
export interface QuickActionsWidgetConfig {
  actions: QuickActionId[];
}

/** 文档部件的单个条目：本地文件路径或远程 HTTPS 链接。 */
export interface HomeDocEntry {
  id: string;
  kind: 'local' | 'remote';
  /** 展示名称；本地取文件名，远程默认取链接末段。 */
  name: string;
  /** `kind === 'local'` 时的文档绝对路径。 */
  path?: string;
  /** `kind === 'remote'` 时的无凭据 HTTPS 链接。 */
  url?: string;
}

/** 文档部件配置。 */
export interface DocsWidgetConfig {
  documents: HomeDocEntry[];
}

/** 版本更新日志部件配置。 */
export interface ChangelogWidgetConfig {
  showBuildInfo: boolean;
}

/** 收藏实例部件当前没有配置项；保留对象形状以便未来扩展。 */
export type FavoritesWidgetConfig = Record<string, never>;

/** 各部件配置的映射，是配置类型的唯一来源。 */
export interface HomeWidgetConfigMap {
  clock: ClockWidgetConfig;
  quotes: QuotesWidgetConfig;
  metrics: MetricsWidgetConfig;
  favorites: FavoritesWidgetConfig;
  quickActions: QuickActionsWidgetConfig;
  changelog: ChangelogWidgetConfig;
  docs: DocsWidgetConfig;
}

/** 单个部件的持久化状态；数组顺序即主页展示顺序。 */
export type HomeWidgetState = {
  [K in keyof HomeWidgetConfigMap]: {
    id: K;
    enabled: boolean;
    config: HomeWidgetConfigMap[K];
  };
}[keyof HomeWidgetConfigMap];

/** 主页布局设置；`version` 供未来结构升级使用。 */
export interface HomeSettings {
  version: 1;
  widgets: HomeWidgetState[];
}

/** 各部件的默认配置。 */
export const HOME_WIDGET_DEFAULT_CONFIG: Readonly<HomeWidgetConfigMap> = {
  clock: { hour24: true, showDate: true, showGreeting: true },
  quotes: {
    provider: 'random',
    categories: [],
    showAuthor: true,
    showSource: true,
    rotation: '30s',
  },
  metrics: { items: ['favorites', 'running', 'platforms'] },
  favorites: {},
  quickActions: {
    actions: ['add-instance', 'manage-instances', 'open-settings', 'check-update'],
  },
  changelog: { showBuildInfo: true },
  docs: { documents: [] },
};

/** 默认主页布局：时钟与名言并排，文档部件默认关闭。 */
export const DEFAULT_HOME_SETTINGS: HomeSettings = {
  version: 1,
  widgets: [
    { id: 'clock', enabled: true, config: { ...HOME_WIDGET_DEFAULT_CONFIG.clock } },
    { id: 'quotes', enabled: true, config: { ...HOME_WIDGET_DEFAULT_CONFIG.quotes } },
    { id: 'metrics', enabled: true, config: { ...HOME_WIDGET_DEFAULT_CONFIG.metrics } },
    { id: 'favorites', enabled: true, config: {} },
    {
      id: 'quickActions',
      enabled: true,
      config: { ...HOME_WIDGET_DEFAULT_CONFIG.quickActions },
    },
    { id: 'changelog', enabled: true, config: { ...HOME_WIDGET_DEFAULT_CONFIG.changelog } },
    { id: 'docs', enabled: false, config: { ...HOME_WIDGET_DEFAULT_CONFIG.docs } },
  ],
};

/** 名言部件的单条数据；作者或出处缺失时为空字符串。 */
export interface Quote {
  text: string;
  author: string;
  source: string;
}

/** 文档部件读取到的正文；名称为主进程校验后的展示名。 */
export interface HomeDocContent {
  name: string;
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrlString(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isHomeMetricId(value: unknown): value is HomeMetricId {
  return typeof value === 'string' && (HOME_METRIC_IDS as readonly string[]).includes(value);
}

function isQuoteRotation(value: unknown): value is QuoteRotationInterval {
  return (
    typeof value === 'string' && (QUOTE_ROTATION_INTERVALS as readonly string[]).includes(value)
  );
}

function isQuoteProvider(value: unknown): value is QuoteProviderSetting {
  return value === 'hitokoto' || value === 'jinrishici' || value === 'random';
}

function isQuickActionId(value: unknown): value is QuickActionId {
  return typeof value === 'string' && (QUICK_ACTION_IDS as readonly string[]).includes(value);
}

function isHitokotoCategory(value: unknown): value is string {
  return typeof value === 'string' && (HITOKOTO_CATEGORY_IDS as readonly string[]).includes(value);
}

/** 去重保序地收敛字符串列表到合法值集合。 */
function sanitizeEnumList<T extends string>(
  value: unknown,
  isValid: (entry: unknown) => entry is T,
): T[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<T>();
  for (const entry of value) {
    if (isValid(entry) && !seen.has(entry)) seen.add(entry);
  }
  return [...seen];
}

/** 收敛并去重文档条目；缺字段、非法链接或超量的条目被丢弃。 */
function sanitizeDocEntries(value: unknown): HomeDocEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: HomeDocEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    if (raw.kind === 'local' && typeof raw.path === 'string' && raw.path) {
      seen.add(id);
      entries.push({ id, kind: 'local', name, path: raw.path });
    } else if (raw.kind === 'remote' && typeof raw.url === 'string' && isHttpsUrlString(raw.url)) {
      seen.add(id);
      entries.push({ id, kind: 'remote', name, url: raw.url });
    }
    if (entries.length >= 100) break;
  }
  return entries;
}

/** 逐字段归一化单个部件的配置；字段缺失或非法时回退默认值。 */
function normalizeWidgetConfig(id: HomeWidgetId, value: unknown): HomeWidgetConfigMap[HomeWidgetId] {
  const source = isRecord(value) ? value : {};
  const defaults = HOME_WIDGET_DEFAULT_CONFIG;
  switch (id) {
    case 'clock':
      return {
        hour24: boolOr(source.hour24, defaults.clock.hour24),
        showDate: boolOr(source.showDate, defaults.clock.showDate),
        showGreeting: boolOr(source.showGreeting, defaults.clock.showGreeting),
      };
    case 'quotes':
      return {
        provider: isQuoteProvider(source.provider) ? source.provider : defaults.quotes.provider,
        categories: sanitizeEnumList(source.categories, isHitokotoCategory),
        showAuthor: boolOr(source.showAuthor, defaults.quotes.showAuthor),
        showSource: boolOr(source.showSource, defaults.quotes.showSource),
        rotation: isQuoteRotation(source.rotation) ? source.rotation : defaults.quotes.rotation,
      };
    case 'metrics':
      return { items: sanitizeEnumList(source.items, isHomeMetricId) };
    case 'favorites':
      return {};
    case 'quickActions':
      return { actions: sanitizeEnumList(source.actions, isQuickActionId) };
    case 'changelog':
      return { showBuildInfo: boolOr(source.showBuildInfo, defaults.changelog.showBuildInfo) };
    case 'docs':
      return { documents: sanitizeDocEntries(source.documents) };
  }
}

/** 判断单个部件配置是否满足严格形状（不补默认值），供设置补丁校验使用。 */
export function isHomeWidgetConfigValid(id: HomeWidgetId, value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (id) {
    case 'clock':
      return (
        typeof value.hour24 === 'boolean' &&
        typeof value.showDate === 'boolean' &&
        typeof value.showGreeting === 'boolean'
      );
    case 'quotes':
      return (
        isQuoteProvider(value.provider) &&
        Array.isArray(value.categories) &&
        value.categories.every(isHitokotoCategory) &&
        typeof value.showAuthor === 'boolean' &&
        typeof value.showSource === 'boolean' &&
        isQuoteRotation(value.rotation)
      );
    case 'metrics':
      return Array.isArray(value.items) && value.items.every(isHomeMetricId);
    case 'favorites':
      return Object.keys(value).length === 0;
    case 'quickActions':
      return Array.isArray(value.actions) && value.actions.every(isQuickActionId);
    case 'changelog':
      return typeof value.showBuildInfo === 'boolean';
    case 'docs':
      return Array.isArray(value.documents) && value.documents.every(isHomeDocEntryShape);
  }
}

function isHomeDocEntryShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.name !== 'string' || !value.name.trim()) return false;
  if (value.kind === 'local') return typeof value.path === 'string' && value.path.length > 0;
  if (value.kind === 'remote') return typeof value.url === 'string' && isHttpsUrlString(value.url);
  return false;
}

function isHomeWidgetStateShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const id = value.id;
  if (typeof id !== 'string' || !(id in HOME_WIDGET_DEFAULT_CONFIG)) return false;
  if (typeof value.enabled !== 'boolean') return false;
  return isHomeWidgetConfigValid(id as HomeWidgetId, value.config);
}

/** 判断值是否满足主页设置的严格形状；不校验部件是否齐全。 */
export function isHomeSettingsShape(value: unknown): value is HomeSettings {
  if (!isRecord(value) || !Array.isArray(value.widgets)) return false;
  return value.widgets.every(isHomeWidgetStateShape);
}

/**
 * 将任意来源数据归一化为完整的主页设置。
 *
 * 未知部件 ID 与重复 ID 被丢弃，缺失的部件按默认布局追加到末尾，
 * 非法字段逐项回退默认值，保证返回值始终可直接渲染与持久化。
 *
 * @param source - 待归一化的原始数据。
 * @returns 字段完整的主页设置。
 */
export function normalizeHomeSettings(source: unknown): HomeSettings {
  const rawWidgets = isRecord(source) && Array.isArray(source.widgets) ? source.widgets : [];
  const seen = new Set<HomeWidgetId>();
  const widgets: HomeWidgetState[] = [];
  for (const raw of rawWidgets) {
    if (!isRecord(raw) || typeof raw.id !== 'string') continue;
    const id = raw.id as HomeWidgetId;
    if (!(id in HOME_WIDGET_DEFAULT_CONFIG) || seen.has(id)) continue;
    seen.add(id);
    widgets.push({
      id,
      enabled: raw.enabled === true,
      config: normalizeWidgetConfig(id, raw.config),
    } as HomeWidgetState);
  }
  for (const widget of DEFAULT_HOME_SETTINGS.widgets) {
    if (!seen.has(widget.id)) {
      widgets.push({
        id: widget.id,
        enabled: widget.enabled,
        // 传入默认配置以重建全新对象，避免与共享默认值共用引用。
        config: normalizeWidgetConfig(widget.id, widget.config),
      } as HomeWidgetState);
    }
  }
  return { version: 1, widgets };
}
