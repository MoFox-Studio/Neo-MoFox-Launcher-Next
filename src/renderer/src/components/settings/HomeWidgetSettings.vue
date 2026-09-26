<script setup lang="ts">
// 编辑器的内容设置面板：只更新父组件草稿，保存由编辑器统一处理。
import { computed, ref } from 'vue';
import type {
  ChangelogWidgetConfig,
  ClockWidgetConfig,
  HomeDocEntry,
  HomeMetricId,
  HomeWidgetConfigMap,
  HomeWidgetId,
  HomeWidgetState,
  QuoteProviderSetting,
  QuoteRotationInterval,
  QuotesWidgetConfig,
  QuickActionId,
} from '@shared/domain/home';
import {
  HITOKOTO_CATEGORIES,
  HOME_METRIC_IDS,
  HOME_WIDGET_DEFAULT_CONFIG,
} from '@shared/domain/home';
import { mofoxApi } from '@/services/mofox-api';
import { QUICK_ACTION_DEFINITIONS } from '@/utils/quick-actions';
import { QUOTE_PROVIDER_OPTIONS, QUOTE_ROTATION_OPTIONS } from '@/data/quote-providers';

const props = defineProps<{
  widgets: HomeWidgetState[];
  widget: HomeWidgetState;
}>();
const emit = defineEmits<{
  update: [id: HomeWidgetId, patch: { config?: Record<string, unknown> }];
}>();
const widgets = computed(() => props.widgets);
function updateWidget(id: HomeWidgetId, patch: { config?: Record<string, unknown> }): void {
  emit('update', id, patch);
}

/** 仪表盘指标的展示名。 */
const METRIC_LABELS: Record<HomeMetricId, string> = {
  total: '全部实例',
  favorites: '收藏实例',
  running: '正在运行',
  error: '需要处理',
  platforms: '平台类型',
};

/** 读取指定部件的当前配置；缺失时回退默认值。 */
function widgetConfig<K extends HomeWidgetId>(id: K): HomeWidgetConfigMap[K] {
  const state = widgets.value.find((widget) => widget.id === id);
  return (state?.config ?? HOME_WIDGET_DEFAULT_CONFIG[id]) as HomeWidgetConfigMap[K];
}

const clockConfig = computed(() => widgetConfig('clock'));
const quotesConfig = computed(() => widgetConfig('quotes'));
const metricsConfig = computed(() => widgetConfig('metrics'));
const quickActionsConfig = computed(() => widgetConfig('quickActions'));
const changelogConfig = computed(() => widgetConfig('changelog'));
const docsConfig = computed(() => widgetConfig('docs'));

function patchClock(patch: Partial<ClockWidgetConfig>): void {
  updateWidget('clock', { config: { ...clockConfig.value, ...patch } });
}

function patchQuotes(patch: Partial<QuotesWidgetConfig>): void {
  updateWidget('quotes', { config: { ...quotesConfig.value, ...patch } });
}

/** 切换仪表盘指标；至少保留一个指标，避免出现空部件。 */
function toggleMetric(id: HomeMetricId): void {
  const items = metricsConfig.value.items;
  if (items.includes(id) && items.length === 1) return;
  const next = items.includes(id) ? items.filter((entry) => entry !== id) : [...items, id];
  updateWidget('metrics', { config: { items: next } });
}

/** 切换一言分类；全部不选即返回全部分类。 */
function toggleQuoteCategory(category: string): void {
  const categories = quotesConfig.value.categories;
  const next = categories.includes(category)
    ? categories.filter((entry) => entry !== category)
    : [...categories, category];
  patchQuotes({ categories: next });
}

/** 切换快捷动作按钮。 */
function toggleQuickAction(id: QuickActionId): void {
  const actions = quickActionsConfig.value.actions;
  const next = actions.includes(id) ? actions.filter((entry) => entry !== id) : [...actions, id];
  updateWidget('quickActions', { config: { actions: next } });
}

function patchChangelog(patch: Partial<ChangelogWidgetConfig>): void {
  updateWidget('changelog', { config: { ...changelogConfig.value, ...patch } });
}

/** 文档列表的本地编辑状态。 */
const docsBusy = ref(false);
const docsError = ref<string | null>(null);
const remoteUrl = ref('');
const localPath = ref('');

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

function removeDoc(id: string): void {
  const documents = docsConfig.value.documents.filter((entry) => entry.id !== id);
  updateWidget('docs', { config: { documents } });
}

/** 从路径末段推导文档展示名，兼容 Windows 与 POSIX 分隔符。 */
function basenameOfPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const segment = trimmed.split(/[\\/]/).pop();
  return segment || path;
}

/** 手输本地路径的即时校验：扩展名、去重与文件存在性。 */
async function addLocalPath(): Promise<void> {
  const path = localPath.value.trim();
  docsError.value = null;
  if (!path) return;
  if (!/\.(?:md|markdown|txt)$/i.test(path)) {
    docsError.value = '本地文档仅支持 .md / .markdown / .txt 文件';
    return;
  }
  if (docsConfig.value.documents.some((entry) => entry.kind === 'local' && entry.path === path)) {
    docsError.value = '该文档已在列表中';
    return;
  }
  docsBusy.value = true;
  try {
    // 复用通用路径探测：绝对路径、存在且不是目录才允许加入。
    const inspection = await mofoxApi.inspectImportPath(path);
    if (!inspection.exists) {
      docsError.value = '文件不存在，请检查路径是否正确';
      return;
    }
    if (inspection.isDirectory) {
      docsError.value = '该路径是目录，请填写文档文件的完整路径';
      return;
    }
    const entry: HomeDocEntry = {
      id: globalThis.crypto.randomUUID(),
      kind: 'local',
      name: basenameOfPath(path),
      path,
    };
    const documents = [...docsConfig.value.documents, entry].slice(0, 100);
    updateWidget('docs', { config: { documents } });
    localPath.value = '';
  } catch (error) {
    docsError.value = describeError(error);
  } finally {
    docsBusy.value = false;
  }
}

/** 弹出系统对话框选择本地文档；重复路径自动跳过。 */
async function addLocalDocs(): Promise<void> {
  if (docsBusy.value) return;
  docsBusy.value = true;
  docsError.value = null;
  try {
    const picked = await mofoxApi.pickHomeDocs();
    if (!picked || picked.length === 0) return;
    const existing = docsConfig.value.documents;
    const knownPaths = new Set(
      existing.filter((entry) => entry.kind === 'local').map((entry) => entry.path),
    );
    const additions = picked.filter((entry) => !knownPaths.has(entry.path));
    if (additions.length === 0) return;
    const documents = [...existing, ...additions].slice(0, 100);
    updateWidget('docs', { config: { documents } });
  } catch (error) {
    docsError.value = describeError(error);
  } finally {
    docsBusy.value = false;
  }
}

/** 从链接末段推导远程文档的展示名。 */
function deriveRemoteDocName(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    let name = '';
    try {
      name = segment ? decodeURIComponent(segment) : '';
    } catch {
      name = segment ?? '';
    }
    if (!name) name = parsed.hostname;
    return name.length > 60 ? `${name.slice(0, 57)}...` : name;
  } catch {
    return url;
  }
}

/** 添加远程文档条目；仅接受无凭据的 HTTPS 链接。 */
function addRemoteDoc(): void {
  const url = remoteUrl.value.trim();
  docsError.value = null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    docsError.value = '远程文档链接无效';
    return;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    docsError.value = '远程文档链接必须是无凭据的 HTTPS 地址';
    return;
  }
  const entry: HomeDocEntry = {
    id: globalThis.crypto.randomUUID(),
    kind: 'remote',
    name: deriveRemoteDocName(url),
    url,
  };
  const documents = [...docsConfig.value.documents, entry].slice(0, 100);
  updateWidget('docs', { config: { documents } });
  remoteUrl.value = '';
}
</script>
<template>
  <div class="home-config">
    <!-- 时钟与日期 -->
    <template v-if="widget.id === 'clock'">
      <div class="home-config__row">
        <div class="home-config__text">
          <span class="home-config__label">24 小时制</span>
          <span class="home-config__desc">关闭后使用 12 小时制显示</span>
        </div>
        <button
          type="button"
          class="md-switch"
          aria-label="24 小时制"
          role="switch"
          :aria-checked="clockConfig.hour24"
          :class="{ 'md-switch--checked': clockConfig.hour24 }"
          @click="patchClock({ hour24: !clockConfig.hour24 })"
        >
          <span class="md-switch__thumb"></span>
        </button>
      </div>
      <div class="home-config__row">
        <div class="home-config__text">
          <span class="home-config__label">显示日期</span>
        </div>
        <button
          type="button"
          class="md-switch"
          aria-label="显示日期"
          role="switch"
          :aria-checked="clockConfig.showDate"
          :class="{ 'md-switch--checked': clockConfig.showDate }"
          @click="patchClock({ showDate: !clockConfig.showDate })"
        >
          <span class="md-switch__thumb"></span>
        </button>
      </div>
      <div class="home-config__row">
        <div class="home-config__text">
          <span class="home-config__label">显示问候语</span>
        </div>
        <button
          type="button"
          class="md-switch"
          aria-label="显示问候语"
          role="switch"
          :aria-checked="clockConfig.showGreeting"
          :class="{ 'md-switch--checked': clockConfig.showGreeting }"
          @click="patchClock({ showGreeting: !clockConfig.showGreeting })"
        >
          <span class="md-switch__thumb"></span>
        </button>
      </div>
    </template>

    <!-- 名人名言 -->
    <template v-else-if="widget.id === 'quotes'">
      <div class="home-config__row home-config__row--column">
        <span class="home-config__label">内容来源</span>
        <div class="home-segment" role="radiogroup" aria-label="名言来源">
          <button
            v-for="option in QUOTE_PROVIDER_OPTIONS"
            :key="option.id"
            type="button"
            class="home-segment__button state-layer"
            :class="{ 'home-segment__button--on': quotesConfig.provider === option.id }"
            :title="option.description"
            @click="patchQuotes({ provider: option.id as QuoteProviderSetting })"
          >
            <span class="msr" aria-hidden="true">{{ option.icon }}</span>
            {{ option.label }}
          </button>
        </div>
      </div>
      <div class="home-config__row home-config__row--column">
        <span class="home-config__label">一言分类</span>
        <p class="home-config__hint">仅对「一言」来源生效；不选任何分类时返回全部分类。</p>
        <div class="home-chip-row">
          <button
            v-for="category in HITOKOTO_CATEGORIES"
            :key="category.id"
            type="button"
            class="home-chip state-layer"
            :class="{ 'home-chip--on': quotesConfig.categories.includes(category.id) }"
            @click="toggleQuoteCategory(category.id)"
          >
            {{ category.label }}
          </button>
        </div>
      </div>
      <div class="home-config__row home-config__row--column">
        <span class="home-config__label">自动轮换</span>
        <div class="home-chip-row">
          <button
            v-for="option in QUOTE_ROTATION_OPTIONS"
            :key="option.id"
            type="button"
            class="home-chip state-layer"
            :class="{ 'home-chip--on': quotesConfig.rotation === option.id }"
            @click="patchQuotes({ rotation: option.id as QuoteRotationInterval })"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div class="home-config__row">
        <div class="home-config__text">
          <span class="home-config__label">显示作者</span>
        </div>
        <button
          type="button"
          class="md-switch"
          aria-label="显示作者"
          role="switch"
          :aria-checked="quotesConfig.showAuthor"
          :class="{ 'md-switch--checked': quotesConfig.showAuthor }"
          @click="patchQuotes({ showAuthor: !quotesConfig.showAuthor })"
        >
          <span class="md-switch__thumb"></span>
        </button>
      </div>
      <div class="home-config__row">
        <div class="home-config__text">
          <span class="home-config__label">显示出处</span>
        </div>
        <button
          type="button"
          class="md-switch"
          aria-label="显示出处"
          role="switch"
          :aria-checked="quotesConfig.showSource"
          :class="{ 'md-switch--checked': quotesConfig.showSource }"
          @click="patchQuotes({ showSource: !quotesConfig.showSource })"
        >
          <span class="md-switch__thumb"></span>
        </button>
      </div>
    </template>

    <!-- 仪表盘 -->
    <template v-else-if="widget.id === 'metrics'">
      <div class="home-config__row home-config__row--column">
        <span class="home-config__label">展示的指标</span>
        <p class="home-config__hint">至少保留一个指标；顺序与下方排列一致。</p>
        <div class="home-chip-row">
          <button
            v-for="metric in HOME_METRIC_IDS"
            :key="metric"
            type="button"
            class="home-chip state-layer"
            :class="{ 'home-chip--on': metricsConfig.items.includes(metric) }"
            @click="toggleMetric(metric)"
          >
            {{ METRIC_LABELS[metric] }}
          </button>
        </div>
      </div>
    </template>

    <!-- 快捷操作 -->
    <template v-else-if="widget.id === 'quickActions'">
      <div class="home-config__row home-config__row--column">
        <span class="home-config__label">展示的动作</span>
        <div class="home-chip-row">
          <button
            v-for="action in QUICK_ACTION_DEFINITIONS"
            :key="action.id"
            type="button"
            class="home-chip state-layer"
            :class="{ 'home-chip--on': quickActionsConfig.actions.includes(action.id) }"
            @click="toggleQuickAction(action.id)"
          >
            <span class="msr" aria-hidden="true">{{ action.icon }}</span>
            {{ action.label }}
          </button>
        </div>
      </div>
    </template>

    <!-- 版本更新日志 -->
    <template v-else-if="widget.id === 'changelog'">
      <div class="home-config__row">
        <div class="home-config__text">
          <span class="home-config__label">显示构建信息</span>
          <span class="home-config__desc">版本号、构建渠道与提交哈希</span>
        </div>
        <button
          type="button"
          class="md-switch"
          aria-label="显示构建信息"
          role="switch"
          :aria-checked="changelogConfig.showBuildInfo"
          :class="{ 'md-switch--checked': changelogConfig.showBuildInfo }"
          @click="patchChangelog({ showBuildInfo: !changelogConfig.showBuildInfo })"
        >
          <span class="md-switch__thumb"></span>
        </button>
      </div>
      <p class="home-config__hint">
        日志内容为当前构建标签对应发行版的说明；开发构建没有对应的发行版。
      </p>
    </template>

    <!-- 收藏实例 -->
    <template v-else-if="widget.id === 'favorites'">
      <p class="home-config__hint">收藏的实例卡片来自实例管理页的收藏标记，暂无额外配置项。</p>
    </template>

    <!-- 文档 -->
    <template v-else-if="widget.id === 'docs'">
      <div class="home-config__row home-config__row--column">
        <span class="home-config__label">已添加的文档</span>
        <div class="docs-list">
          <div v-for="entry in docsConfig.documents" :key="entry.id" class="docs-list__item">
            <span class="msr docs-list__icon" aria-hidden="true">
              {{ entry.kind === 'remote' ? 'language' : 'article' }}
            </span>
            <span class="docs-list__name" :title="entry.kind === 'remote' ? entry.url : entry.path">
              {{ entry.name }}
            </span>
            <span class="docs-list__kind">
              {{ entry.kind === 'remote' ? '远程' : '本地' }}
            </span>
            <button
              type="button"
              class="home-row__icon-button state-layer"
              title="移除"
              aria-label="移除文档"
              @click="removeDoc(entry.id)"
            >
              <span class="msr" aria-hidden="true">close</span>
            </button>
          </div>
          <p v-if="docsConfig.documents.length === 0" class="home-config__hint">
            还没有文档；添加后会在主页「文档」部件中展示。
          </p>
        </div>
      </div>
      <div class="home-config__row home-config__row--column">
        <span class="home-config__label">添加文档</span>
        <div class="docs-add-row">
          <div class="input-field docs-url-field">
            <input
              v-model="localPath"
              type="text"
              class="input-field__native"
              placeholder="输入本地文档路径，如 D:\Docs\说明.md"
              spellcheck="false"
              autocomplete="off"
              @keydown.enter.prevent="addLocalPath"
            />
          </div>
          <button
            type="button"
            class="docs-add-button state-layer"
            :disabled="docsBusy"
            @click="addLocalPath"
          >
            <span class="msr" aria-hidden="true">add</span>
            添加本地文档
          </button>
          <button
            type="button"
            class="docs-add-button docs-add-button--ghost state-layer"
            :disabled="docsBusy"
            @click="addLocalDocs"
          >
            <span class="msr" aria-hidden="true">upload_file</span>
            浏览文件…
          </button>
        </div>
        <div class="docs-add-row">
          <div class="input-field docs-url-field">
            <input
              v-model="remoteUrl"
              type="url"
              class="input-field__native"
              placeholder="https://example.com/说明.md"
              spellcheck="false"
              autocomplete="off"
              @keydown.enter.prevent="addRemoteDoc"
            />
          </div>
          <button type="button" class="docs-add-button state-layer" @click="addRemoteDoc">
            <span class="msr" aria-hidden="true">add_link</span>
            添加远程文档
          </button>
        </div>
        <p class="home-config__hint">
          本地支持 .md / .markdown / .txt 文件；远程仅接受 HTTPS Markdown 链接；单个文档不超过 2
          MB。
        </p>
        <div v-if="docsError" class="settings-note settings-note--error">
          <span class="msr settings-note__icon">error</span>
          <span>{{ docsError }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
<style scoped src="./settings-panel.css"></style>

<style scoped>
.home-row__icon-button {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}

.home-row__icon-button:hover:not(:disabled) {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
}

.home-row__icon-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

/* 展开的专属配置区。 */
.home-config {
  display: grid;
  gap: 3px;
  margin: 0 14px 8px;
  padding: 10px;
  border-radius: 12px;
  background: var(--app-glass-row);
}

.home-config__row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 44px;
  padding: 4px 8px;
}

.home-config__row--column {
  align-items: flex-start;
  flex-direction: column;
  gap: 8px;
}

.home-config__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.home-config__label {
  font: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface);
}

.home-config__desc {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.home-config__hint {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

/* 分段选择器（名言来源）。 */
.home-segment {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
}

.home-segment__button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.home-segment__button .msr {
  font-size: 18px;
}

.home-segment__button--on {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

/* 多选 chips（分类、指标、动作、轮换间隔）。 */
.home-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.home-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.home-chip .msr {
  font-size: 16px;
}

.home-chip--on {
  border-color: var(--md-sys-color-primary);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

/* 文档列表与添加行。 */
.docs-list {
  width: 100%;
  display: grid;
  gap: 3px;
}

.docs-list__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 4px 10px;
  border-radius: 10px;
  background: var(--md-sys-color-surface-container);
}

.docs-list__icon {
  flex: none;
  color: var(--md-sys-color-primary);
  font-size: 20px;
}

.docs-list__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface);
}

.docs-list__kind {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-small);
}

.docs-add-row {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.docs-url-field {
  flex: 1;
  min-width: 220px;
}

.docs-url-field .input-field__native {
  text-align: left;
}

.docs-add-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.docs-add-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 次级动作按钮（浏览文件）：弱化为描边样式。 */
.docs-add-button--ghost {
  background: transparent;
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}
</style>
