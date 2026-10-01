<script setup lang="ts">
// 编辑器的内容设置面板：只更新父组件草稿，保存由编辑器统一处理。
import { computed, nextTick, ref, watch } from 'vue';
import type {
  ChangelogWidgetConfig,
  ClockWidgetConfig,
  HomeDocEntry,
  HomeLinkEntry,
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
  MAX_HOME_NOTE_LENGTH,
  MAX_HOME_LINKS,
  MAX_GREETING_LENGTH,
  isIntranetHostname,
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
const notesConfig = computed(() => widgetConfig('notes'));
const linksConfig = computed(() => widgetConfig('links'));
const linkName = ref('');
const linkUrl = ref('');
const linkError = ref('');

/** 链接网址的即时校验：返回错误文案，合法时返回空字符串。 */
function describeLinkProblem(name: string, url: string): string {
  if (!name) return '链接名称不能为空';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '链接无效，请填写完整的网址';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return '链接仅支持 HTTP(S) 网址';
  }
  if (parsed.username || parsed.password) {
    return '链接网址不能携带用户名或密码';
  }
  if (url.length > 2048) return '网址长度超出限制';
  return '';
}

/** 从链接中推导展示用的主机名徽标；解析失败时回退通用文案。 */
function hostOfLinkUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '链接';
  }
}

function addLink(): void {
  const name = linkName.value.trim();
  const url = linkUrl.value.trim();
  linkError.value = '';
  const problem = describeLinkProblem(name, url);
  if (problem) {
    linkError.value = problem;
    return;
  }
  if (linksConfig.value.links.length >= MAX_HOME_LINKS) {
    linkError.value = '最多添加 12 个链接';
    return;
  }
  updateWidget('links', {
    config: {
      links: [...linksConfig.value.links, { id: globalThis.crypto.randomUUID(), name, url }],
    },
  });
  linkName.value = '';
  linkUrl.value = '';
}

/** 展开编辑中的链接条目 id 与草稿字段。 */
const editingLinkId = ref<string | null>(null);
const editLinkName = ref('');
const editLinkUrl = ref('');

function toggleLinkExpand(entry: HomeLinkEntry): void {
  linkError.value = '';
  if (editingLinkId.value === entry.id) {
    editingLinkId.value = null;
    return;
  }
  editingLinkId.value = entry.id;
  editLinkName.value = entry.name;
  editLinkUrl.value = entry.url;
}

function removeLink(id: string): void {
  if (editingLinkId.value === id) editingLinkId.value = null;
  updateWidget('links', {
    config: { links: linksConfig.value.links.filter((entry) => entry.id !== id) },
  });
}

/** 保存展开链接条目的修改：名称与网址均通过校验后才写回草稿。 */
function saveLinkEdit(entry: HomeLinkEntry): void {
  const name = editLinkName.value.trim();
  const url = editLinkUrl.value.trim();
  linkError.value = '';
  const problem = describeLinkProblem(name, url);
  if (problem) {
    linkError.value = problem;
    return;
  }
  updateWidget('links', {
    config: {
      links: linksConfig.value.links.map((item) =>
        item.id === entry.id ? { ...item, name, url } : item,
      ),
    },
  });
  editingLinkId.value = null;
}

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
/** 展开条目编辑流程的错误；与添加流程分离，便于把提示就近贴在「保存修改」上方。 */
const editDocError = ref<string | null>(null);
const remoteUrl = ref('');
const localPath = ref('');

/** 添加文档的来源类型：本地填路径，远程填 HTTPS 链接。 */
const docsSource = ref<'local' | 'remote'>('local');
const docsSourceSelect = ref<{ value: string }>();
// Material Web 组件的选中态不随属性自动刷新，参照 HomeGeometrySelect 手动同步。
watch(
  [docsSourceSelect, docsSource],
  async () => {
    await nextTick();
    if (docsSourceSelect.value) docsSourceSelect.value.value = docsSource.value;
  },
  { flush: 'post' },
);
function onDocsSourceChange(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  if ((value !== 'local' && value !== 'remote') || docsSource.value === value) return;
  docsSource.value = value;
  docsError.value = null;
}

/** 按当前来源类型分发「添加文档」动作。 */
function submitNewDoc(): void {
  if (docsSource.value === 'local') void addLocalPath();
  else addRemoteDoc();
}

/** 展开编辑中的文档条目 id 与草稿字段。 */
const editingDocId = ref<string | null>(null);
const editName = ref('');
const editSource = ref('');

function toggleDocExpand(entry: HomeDocEntry): void {
  docsError.value = null;
  editDocError.value = null;
  if (editingDocId.value === entry.id) {
    editingDocId.value = null;
    return;
  }
  editingDocId.value = entry.id;
  editName.value = entry.name;
  editSource.value = entry.kind === 'remote' ? (entry.url ?? '') : (entry.path ?? '');
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

function removeDoc(id: string): void {
  if (editingDocId.value === id) {
    editingDocId.value = null;
    editDocError.value = null;
  }
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

/** 远程文档链接的即时校验：返回错误文案，合法时返回空字符串。 */
function describeRemoteDocUrlProblem(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '远程文档链接无效';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return '远程文档链接仅支持 HTTP(S) 地址';
  }
  if (parsed.username || parsed.password) {
    return '远程文档链接不能携带用户名或密码';
  }
  if (parsed.protocol === 'http:' && !isIntranetHostname(parsed.hostname)) {
    return '公网地址必须使用 HTTPS；内网地址允许 HTTP';
  }
  return '';
}

/** 添加远程文档条目；HTTPS 不限主机，HTTP 仅限本机与内网。 */
function addRemoteDoc(): void {
  const url = remoteUrl.value.trim();
  docsError.value = null;
  const problem = describeRemoteDocUrlProblem(url);
  if (problem) {
    docsError.value = problem;
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

/** 编辑态弹出文件选择器，用选中的文件替换本地路径（保存时生效）。 */
async function replaceLocalDocFile(entry: HomeDocEntry): Promise<void> {
  if (docsBusy.value) return;
  docsBusy.value = true;
  editDocError.value = null;
  try {
    const picked = await mofoxApi.pickHomeDocs();
    const next = picked?.[0];
    if (!next) return;
    const duplicated = docsConfig.value.documents.some(
      (item) => item.id !== entry.id && item.kind === 'local' && item.path === next.path,
    );
    if (duplicated) {
      editDocError.value = '该文档已在列表中';
      return;
    }
    editSource.value = next.path ?? '';
  } catch (error) {
    editDocError.value = describeError(error);
  } finally {
    docsBusy.value = false;
  }
}

/** 保存展开条目的修改：名称必填，路径或链接按来源类型校验。 */
async function saveDocEdit(entry: HomeDocEntry): Promise<void> {
  const name = editName.value.trim();
  const source = editSource.value.trim();
  editDocError.value = null;
  if (!name) {
    editDocError.value = '文档名称不能为空';
    return;
  }
  const documents = docsConfig.value.documents;
  if (entry.kind === 'local') {
    if (!source) {
      editDocError.value = '文件路径不能为空';
      return;
    }
    if (!/\.(?:md|markdown|txt)$/i.test(source)) {
      editDocError.value = '本地文档仅支持 .md / .markdown / .txt 文件';
      return;
    }
    if (
      documents.some((item) => item.id !== entry.id && item.kind === 'local' && item.path === source)
    ) {
      editDocError.value = '该文档已在列表中';
      return;
    }
    if (source !== entry.path) {
      docsBusy.value = true;
      try {
        // 复用通用路径探测：绝对路径、存在且不是目录才允许保存。
        const inspection = await mofoxApi.inspectImportPath(source);
        if (!inspection.exists) {
          editDocError.value = '文件不存在，请检查路径是否正确';
          return;
        }
        if (inspection.isDirectory) {
          editDocError.value = '该路径是目录，请填写文档文件的完整路径';
          return;
        }
      } catch (error) {
        editDocError.value = describeError(error);
        return;
      } finally {
        docsBusy.value = false;
      }
    }
    updateWidget('docs', {
      config: {
        documents: documents.map((item) =>
          item.id === entry.id ? { ...item, name, path: source } : item,
        ),
      },
    });
  } else {
    const problem = describeRemoteDocUrlProblem(source);
    if (problem) {
      editDocError.value = problem;
      return;
    }
    updateWidget('docs', {
      config: {
        documents: documents.map((item) =>
          item.id === entry.id ? { ...item, name, url: source } : item,
        ),
      },
    });
  }
  editingDocId.value = null;
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
      <!-- 自定义问候语依赖「显示问候语」：未开启时隐藏，避免出现不生效的配置。 -->
      <template v-if="clockConfig.showGreeting">
        <label class="home-config__row home-config__row--column"
          >自定义问候语
          <textarea
            class="home-text-input"
            :value="clockConfig.customGreeting ?? ''"
            :maxlength="MAX_GREETING_LENGTH"
            rows="3"
            placeholder="留空使用时段问候语"
            @input="patchClock({ customGreeting: ($event.target as HTMLTextAreaElement).value })"
          />
        </label>
        <p class="home-config__hint">同时用于主页顶部和时钟。留空恢复自动问候语。</p>
      </template>
    </template>

    <template v-else-if="widget.id === 'notes'">
      <label class="home-config__row home-config__row--column"
        >便签内容
        <textarea
          class="home-text-input"
          :value="notesConfig.text"
          :maxlength="MAX_HOME_NOTE_LENGTH"
          rows="9"
          @input="
            updateWidget('notes', {
              config: { text: ($event.target as HTMLTextAreaElement).value },
            })
          "
        />
      </label>
      <p class="home-config__hint">
        {{ notesConfig.text.length }} / {{ MAX_HOME_NOTE_LENGTH }} · 保存布局后生效
      </p>
    </template>
    <template v-else-if="widget.id === 'links'">
      <div class="home-config__row home-config__row--column">
        <span class="home-config__label">已添加的链接</span>
        <div class="docs-list">
          <div
            v-for="entry in linksConfig.links"
            :key="entry.id"
            class="docs-doc"
            :class="{ 'docs-doc--open': editingLinkId === entry.id }"
          >
            <div class="docs-list__item">
              <span class="msr docs-list__icon" aria-hidden="true">link</span>
              <span class="docs-list__name" :title="entry.url">{{ entry.name }}</span>
              <span class="docs-list__kind" :title="entry.url">
                {{ hostOfLinkUrl(entry.url) }}
              </span>
              <button
                type="button"
                class="home-row__icon-button state-layer"
                :aria-expanded="editingLinkId === entry.id"
                :title="editingLinkId === entry.id ? '收起' : '展开编辑'"
                :aria-label="`编辑${entry.name}`"
                @click="toggleLinkExpand(entry)"
              >
                <span
                  class="msr docs-list__chevron"
                  :class="{ 'docs-list__chevron--open': editingLinkId === entry.id }"
                  aria-hidden="true"
                >
                  keyboard_arrow_down
                </span>
              </button>
              <button
                type="button"
                class="home-row__icon-button state-layer"
                title="移除"
                :aria-label="`移除${entry.name}`"
                @click="removeLink(entry.id)"
              >
                <span class="msr" aria-hidden="true">close</span>
              </button>
            </div>
            <!-- 展开后的编辑区：修改名称与网址，保存时统一校验。 -->
            <div v-if="editingLinkId === entry.id" class="docs-list__editor">
              <label class="docs-edit-field">
                <span class="docs-edit-field__label">名称</span>
                <div class="input-field docs-url-field">
                  <input
                    v-model="editLinkName"
                    type="text"
                    class="input-field__native"
                    maxlength="60"
                    @keydown.enter.prevent="saveLinkEdit(entry)"
                  />
                </div>
              </label>
              <label class="docs-edit-field">
                <span class="docs-edit-field__label">网址</span>
                <div class="input-field docs-url-field">
                  <input
                    v-model="editLinkUrl"
                    type="url"
                    class="input-field__native"
                    placeholder="http:// 或 https:// 均可"
                    maxlength="2048"
                    spellcheck="false"
                    autocomplete="off"
                    @keydown.enter.prevent="saveLinkEdit(entry)"
                  />
                </div>
              </label>
              <div class="docs-edit-actions">
                <button
                  type="button"
                  class="docs-add-button state-layer"
                  @click="saveLinkEdit(entry)"
                >
                  <span class="msr" aria-hidden="true">check</span>
                  保存修改
                </button>
              </div>
            </div>
          </div>
          <p v-if="linksConfig.links.length === 0" class="home-config__hint">
            还没有链接；添加后会显示在主页「常用链接」部件中。
          </p>
        </div>
      </div>
      <!-- 添加区：名称与网址分两行输入，整体包进一个背景卡片。 -->
      <div class="docs-add-card">
        <span class="home-config__label">添加链接</span>
        <div class="docs-add-row">
          <div class="input-field docs-url-field">
            <input
              v-model="linkName"
              type="text"
              class="input-field__native"
              placeholder="链接名称，例如：项目文档"
              maxlength="60"
            />
          </div>
        </div>
        <div class="docs-add-row">
          <div class="input-field docs-url-field">
            <input
              v-model="linkUrl"
              type="url"
              class="input-field__native"
              placeholder="http:// 或 https:// 均可"
              maxlength="2048"
              spellcheck="false"
              autocomplete="off"
              @keydown.enter.prevent="addLink"
            />
          </div>
        </div>
        <button
          type="button"
          class="docs-add-button docs-add-button--primary state-layer"
          @click="addLink"
        >
          <span class="msr" aria-hidden="true">add</span>
          添加链接
        </button>
        <p class="home-config__hint">
          最多 12 个；HTTP 与 HTTPS 均可，通过默认浏览器打开。
        </p>
        <div v-if="linkError" class="settings-note settings-note--error">
          <span class="msr settings-note__icon">error</span>
          <span>{{ linkError }}</span>
        </div>
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
      <!-- 一言分类仅对「随机」与「一言」来源生效，其余来源隐藏避免误导。 -->
      <div
        v-if="quotesConfig.provider === 'random' || quotesConfig.provider === 'hitokoto'"
        class="home-config__row home-config__row--column"
      >
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
          <div
            v-for="entry in docsConfig.documents"
            :key="entry.id"
            class="docs-doc"
            :class="{ 'docs-doc--open': editingDocId === entry.id }"
          >
            <div class="docs-list__item">
              <span class="msr docs-list__icon" aria-hidden="true">
                {{ entry.kind === 'remote' ? 'language' : 'article' }}
              </span>
              <span
                class="docs-list__name"
                :title="entry.kind === 'remote' ? entry.url : entry.path"
              >
                {{ entry.name }}
              </span>
              <span class="docs-list__kind">
                {{ entry.kind === 'remote' ? '远程' : '本地' }}
              </span>
              <button
                type="button"
                class="home-row__icon-button state-layer"
                :aria-expanded="editingDocId === entry.id"
                :title="editingDocId === entry.id ? '收起' : '展开编辑'"
                :aria-label="`编辑${entry.name}`"
                @click="toggleDocExpand(entry)"
              >
                <span
                  class="msr docs-list__chevron"
                  :class="{ 'docs-list__chevron--open': editingDocId === entry.id }"
                  aria-hidden="true"
                >
                  keyboard_arrow_down
                </span>
              </button>
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
            <!-- 展开后的编辑区：修改名称与来源，保存时统一校验。 -->
            <div v-if="editingDocId === entry.id" class="docs-list__editor">
              <label class="docs-edit-field">
                <span class="docs-edit-field__label">名称</span>
                <div class="input-field docs-url-field">
                  <input
                    v-model="editName"
                    type="text"
                    class="input-field__native"
                    maxlength="60"
                    @keydown.enter.prevent="saveDocEdit(entry)"
                  />
                </div>
              </label>
              <label v-if="entry.kind === 'local'" class="docs-edit-field">
                <span class="docs-edit-field__label">文件路径</span>
                <div class="docs-add-row">
                  <div class="input-field docs-url-field">
                    <input
                      v-model="editSource"
                      type="text"
                      class="input-field__native"
                      placeholder="输入本地文档路径，如 D:\Docs\说明.md"
                      spellcheck="false"
                      autocomplete="off"
                      @keydown.enter.prevent="saveDocEdit(entry)"
                    />
                  </div>
                  <button
                    type="button"
                    class="docs-add-button docs-add-button--ghost state-layer"
                    :disabled="docsBusy"
                    @click="replaceLocalDocFile(entry)"
                  >
                    <span class="msr" aria-hidden="true">upload_file</span>
                    浏览…
                  </button>
                </div>
              </label>
              <label v-else class="docs-edit-field">
                <span class="docs-edit-field__label">链接</span>
                <div class="input-field docs-url-field">
                  <input
                    v-model="editSource"
                    type="url"
                    class="input-field__native"
                    placeholder="https://example.com/说明.md"
                    spellcheck="false"
                    autocomplete="off"
                    @keydown.enter.prevent="saveDocEdit(entry)"
                  />
                </div>
              </label>
              <div class="docs-edit-actions">
                <button
                  type="button"
                  class="docs-add-button state-layer"
                  :disabled="docsBusy"
                  @click="saveDocEdit(entry)"
                >
                  <span class="msr" aria-hidden="true">check</span>
                  保存修改
                </button>
              </div>
            </div>
          </div>
          <p v-if="docsConfig.documents.length === 0" class="home-config__hint">
            还没有文档；添加后会在主页「文档」部件中展示。
          </p>
        </div>
      </div>
      <!-- 添加区：来源下拉 + 按来源切换的输入行，整体包进一个背景卡片。 -->
      <div class="docs-add-card">
        <span class="home-config__label">添加文档</span>
        <md-outlined-select
          ref="docsSourceSelect"
          class="docs-add-card__select"
          label="文档来源"
          aria-label="文档来源"
          menu-positioning="popover"
          @change="onDocsSourceChange"
        >
          <!-- eslint-disable vue/no-deprecated-slot-attribute -->
          <md-select-option value="local" :selected="docsSource === 'local'">
            <div slot="headline">本地文件</div>
          </md-select-option>
          <md-select-option value="remote" :selected="docsSource === 'remote'">
            <div slot="headline">远程链接</div>
          </md-select-option>
          <!-- eslint-enable vue/no-deprecated-slot-attribute -->
        </md-outlined-select>
        <div v-if="docsSource === 'local'" class="docs-add-row">
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
            class="docs-add-button docs-add-button--ghost state-layer"
            :disabled="docsBusy"
            @click="addLocalDocs"
          >
            <span class="msr" aria-hidden="true">upload_file</span>
            浏览…
          </button>
        </div>
        <div v-else class="docs-add-row">
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
        </div>
        <button
          type="button"
          class="docs-add-button docs-add-button--primary state-layer"
          :disabled="docsBusy"
          @click="submitNewDoc"
        >
          <span class="msr" aria-hidden="true">add</span>
          添加文档
        </button>
        <p class="home-config__hint">
          本地支持 .md / .markdown / .txt 文件；远程链接公网需 HTTPS、内网允许 HTTP；单个文档不超过
          2 MB。
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
.home-text-input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin: 6px 0;
  padding: 10px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: 10px;
  background: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
  font: inherit;
  resize: vertical;
}
[role='alert'] {
  color: var(--md-sys-color-error);
}

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
  grid-template-columns: minmax(0, 1fr);
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
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
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
  max-width: 16ch;
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
  min-width: 0;
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

/* 主动作按钮（添加文档）：铺满卡片宽度，作为该区域的明确落点。 */
.docs-add-button--primary {
  width: 100%;
  justify-content: center;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

/* 文档条目：整块拥有背景；按下箭头展开编辑时背景随之扩大。 */
.docs-doc {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 4px 10px;
  border-radius: 10px;
  background: var(--md-sys-color-surface-container);
  transition: background-color var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.docs-doc--open {
  background: var(--md-sys-color-surface-container-high);
}

/* 展开时标题行不再自带底色，由外层背景统一承载，保持宽度一致。 */
.docs-doc .docs-list__item {
  min-height: 44px;
  padding: 0;
  background: transparent;
}

.docs-list__chevron {
  transition: transform var(--md-sys-motion-duration-short4)
    var(--md-sys-motion-easing-standard);
}

.docs-list__chevron--open {
  transform: rotate(180deg);
}

.docs-list__editor {
  display: grid;
  gap: 10px;
  padding: 10px 0 6px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.docs-edit-field {
  display: grid;
  gap: 2px;
  text-align: left;
}

.docs-edit-field__label {
  font: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.docs-edit-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

/* 添加文档卡片：来源下拉、输入与动作整体包进一个带背景的容器。 */
.docs-add-card {
  width: 100%;
  box-sizing: border-box;
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 14px;
  background: var(--md-sys-color-surface-container);
}

.docs-add-card__select {
  width: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .docs-list__chevron,
  .docs-doc {
    transition: none;
  }
}
</style>
