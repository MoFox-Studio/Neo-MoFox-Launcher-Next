<script setup lang="ts">
// 关于面板：版本信息、启动器更新检查、致谢人物与开源协议；
// 「开源致谢」卡片在面板内切换到完整开源/服务列表，返回按钮回到关于内容。
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import type { LauncherBuildInfo } from '@shared/domain/app-update';
import { normalizeHttpsUrl, renderRemoteMarkdown } from '@/utils/remote-markdown';
import { useLauncherUpdate } from '@/composables/use-launcher-update';
import { mofoxApi } from '@/services/mofox-api';

const { buildInfo, checking, updateInfo, lastError, loadBuildInfo, checkForUpdates } =
  useLauncherUpdate();

onMounted(() => {
  void loadBuildInfo();
});

/** 启动器源代码仓库与许可协议文件地址。 */
const REPOSITORY_URL = 'https://github.com/MoFox-Studio/Neo-MoFox-Launcher-Next';
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;

/** 面板内部视图：`about` 为关于内容，`people` 为致谢人物名单，`oss` 为开源致谢列表。 */
const aboutView = ref<'about' | 'people' | 'oss'>('about');
/** 切换到子列表视图后用于滚动定位的标题元素。 */
const subViewHeader = ref<HTMLElement | null>(null);

/** 打开子列表视图并滚动到列表顶部，隐藏关于内容。 */
async function openSubView(view: 'people' | 'oss'): Promise<void> {
  aboutView.value = view;
  await nextTick();
  subViewHeader.value?.scrollIntoView({ block: 'start' });
}

/** 从子列表视图返回关于内容。 */
function backToAbout(): void {
  aboutView.value = 'about';
}

/** 致谢人物分组图标：按类别 id 映射到 Material Symbols 名称。 */
const PEOPLE_CATEGORY_ICONS: Record<string, string> = { core: 'star', contributors: 'group' };

/** 头像加载失败的用户名集合；命中时回退为首字占位头像。 */
const avatarFailures = reactive(new Set<string>());

/** 头像加载失败时记录用户名，触发占位头像渲染。 */
function markAvatarFailed(username: string): void {
  avatarFailures.add(username);
}

/** 占位头像文本：显示名首字符。 */
function avatarFallback(name: string): string {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

/** 版本描述行：每夜构建的版本号即构建日期，必要时补充人类可读日期与提交哈希。 */
const versionLine = computed(() => {
  const info: LauncherBuildInfo | null = buildInfo.value;
  if (!info) return '正在读取版本信息…';
  const parts = [`版本 ${info.version}`];
  // 版本号本身就是构建日期（流水线写入）时不再重复展示。
  if (info.channel === 'nightly' && info.buildDate && info.version !== info.buildDate) {
    parts.push(`每夜构建 ${formatBuildDate(info.buildDate)}`);
  }
  if (info.commit) parts.push(info.commit);
  return parts.join(' · ');
});

/** 渠道徽标文案：与构建信息文件中的 channel 字段一一对应。 */
const channelLabel = computed(() => {
  const info = buildInfo.value;
  if (!info) return '';
  return info.channel === 'nightly' ? '每夜构建' : '开发构建';
});

/** 发现新版本时的发行日期描述；解析失败时回退为标签名。 */
const releaseDateLine = computed(() => {
  const info = updateInfo.value;
  if (!info) return '';
  const published = Date.parse(info.publishedAt);
  if (Number.isFinite(published)) {
    return `发布于 ${new Date(published).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}`;
  }
  return `标签 ${info.latestTag}`;
});

/** 发行说明经净化后的 HTML；说明为空时不渲染该区块。 */
const releaseNotesHtml = computed(() => {
  const notes = updateInfo.value?.releaseNotes ?? '';
  if (!notes.trim()) return '';
  return renderRemoteMarkdown(notes);
});

/** 手动触发一次更新检查；结果 toast 由组合式函数统一弹出。 */
function handleCheckUpdate(): void {
  void checkForUpdates();
}

/** 前往最新发行版页面；地址由主进程基于仓库与标签生成。 */
function openReleasePage(): void {
  void openExternalUrl(updateInfo.value?.releaseUrl ?? '');
}

/** 把 8 位构建日期格式化为 YYYY-MM-DD。 */
function formatBuildDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** 仅允许系统浏览器打开 HTTPS 链接；无效地址静默忽略。 */
async function openExternalUrl(url: string): Promise<void> {
  const safe = normalizeHttpsUrl(url);
  if (safe) await mofoxApi.openExternal(safe);
}

/** 发行说明中的链接改为交给系统浏览器打开，阻止应用内导航。 */
function handleNotesClick(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor) return;
  event.preventDefault();
  void openExternalUrl(anchor.getAttribute('href') ?? '');
}

/** 单个致谢人物的展示数据。 */
interface LauncherCredit {
  /** 显示名称（昵称或组织名）。 */
  name: string;
  /** GitHub 用户名。 */
  username: string;
  /** GitHub 头像地址；加载失败时回退为首字占位头像。 */
  avatarUrl: string;
  /** 一句话说明该人物的贡献或留言。 */
  note: string;
  /** GitHub 主页地址。 */
  profileUrl: string;
}

/** 按类别组织的致谢分组。 */
interface CreditCategory {
  id: string;
  title: string;
  description: string;
  entries: LauncherCredit[];
}

/**
 * 致谢人物名单：自旧版启动器（Neo-MoFox-Launcher）设置页原样迁移；
 * 头像与资料为 GitHub API 预拉取后固化的静态数据，避免运行时请求触发限流。
 */
const CREDIT_CATEGORIES: CreditCategory[] = [
  {
    id: 'core',
    title: '核心维护',
    description: '项目发起、维护、设计与长期开发支持。',
    entries: [
      {
        name: 'yishan',
        username: 'minecraft1024a',
        avatarUrl: 'https://avatars.githubusercontent.com/u/140055845?v=4',
        note: '项目发起、维护与核心功能设计。',
        profileUrl: 'https://github.com/minecraft1024a',
      },
      {
        name: 'MoFox-Studio',
        username: 'MoFox-Studio',
        avatarUrl: 'https://avatars.githubusercontent.com/u/225730003?v=4',
        note: 'MoFox 工作室 - 设计与开发支持，项目管理。',
        profileUrl: 'https://github.com/MoFox-Studio',
      },
      {
        name: 'ikun两年半',
        username: 'ikun-1145141',
        avatarUrl: 'https://avatars.githubusercontent.com/u/265925499?v=4',
        note: '设计与开发支持。',
        profileUrl: 'https://github.com/ikun-1145141',
      },
      {
        name: 'Sunbiz',
        username: 'sunbiz1024',
        avatarUrl: 'https://avatars.githubusercontent.com/u/98442033?v=4',
        note: '设计与开发支持，特别是 UI 设计与实现。',
        profileUrl: 'https://github.com/sunbiz1024',
      },
      {
        name: 'Lycoris-flower',
        username: 'fuilyha56-wq',
        avatarUrl: 'https://avatars.githubusercontent.com/u/226964479?v=4',
        note: '请支持 Lycoris radiata 喵～',
        profileUrl: 'https://github.com/fuilyha56-wq',
      },
    ],
  },
  {
    id: 'contributors',
    title: '贡献与支持',
    description:
      '感谢对 Neo-MoFox Launcher 提供帮助、支持与灵感，以及测试 Neo-MoFox Launcher 开发版本的朋友们。',
    entries: [
      {
        name: 'luciferring',
        username: 'luciferring',
        avatarUrl: 'https://avatars.githubusercontent.com/u/249419621?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/luciferring',
      },
      {
        name: '蝶宝可爱捏',
        username: 'diebaokeai',
        avatarUrl: 'https://avatars.githubusercontent.com/u/244420175?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/diebaokeai',
      },
      {
        name: 'MoFox-Elysia',
        username: 'MoFox-Elysia',
        avatarUrl: 'https://avatars.githubusercontent.com/u/245707589?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/MoFox-Elysia',
      },
      {
        name: '夢',
        username: 'jgfghuhgh',
        avatarUrl: 'https://avatars.githubusercontent.com/u/126490325?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/jgfghuhgh',
      },
      {
        name: 'ColdLeg',
        username: 'ColdLeg',
        avatarUrl: 'https://avatars.githubusercontent.com/u/251687745?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/ColdLeg',
      },
      {
        name: '小识',
        username: 'Xiaoshi1234',
        avatarUrl: 'https://avatars.githubusercontent.com/u/179480621?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/Xiaoshi1234',
      },
      {
        name: 'liyi3068238601-oss',
        username: 'liyi3068238601-oss',
        avatarUrl: 'https://avatars.githubusercontent.com/u/289515629?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/liyi3068238601-oss',
      },
      {
        name: '满月月',
        username: 'Kistiatsuki',
        avatarUrl: 'https://avatars.githubusercontent.com/u/253261805?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/Kistiatsuki',
      },
      {
        name: '一只无聊的妖怪',
        username: 'yaoguai0701',
        avatarUrl: 'https://avatars.githubusercontent.com/u/291200682?v=4',
        note: '感谢对 Neo-MoFox Launcher 的支持与贡献。',
        profileUrl: 'https://github.com/yaoguai0701',
      },
    ],
  },
];

/** 项目与服务致谢分组；仅在开源致谢列表视图中展示。 */
const CREDIT_GROUPS: {
  id: string;
  icon: string;
  title: string;
  items: { name: string; url: string; tag: string }[];
}[] = [
  {
    id: 'oss',
    icon: 'code',
    title: '开源项目',
    items: [
      { name: 'Electron', url: 'https://www.electronjs.org/', tag: 'MIT' },
      { name: 'Vue 3', url: 'https://vuejs.org/', tag: 'MIT' },
      { name: 'Vite', url: 'https://vite.dev/', tag: 'MIT' },
      { name: 'TypeScript', url: 'https://www.typescriptlang.org/', tag: 'Apache-2.0' },
      { name: 'Pinia', url: 'https://pinia.vuejs.org/', tag: 'MIT' },
      { name: 'Vue Router', url: 'https://router.vuejs.org/', tag: 'MIT' },
      {
        name: 'Material Web',
        url: 'https://github.com/material-components/material-web',
        tag: 'Apache-2.0',
      },
      {
        name: 'Material Color Utilities',
        url: 'https://github.com/material-foundation/material-color-utilities',
        tag: 'Apache-2.0',
      },
      { name: 'Material Symbols', url: 'https://fonts.google.com/icons', tag: 'Apache-2.0' },
      { name: 'xterm.js', url: 'https://xtermjs.org/', tag: 'MIT' },
      { name: 'marked', url: 'https://marked.js.org/', tag: 'MIT' },
      {
        name: 'DOMPurify',
        url: 'https://github.com/cure53/DOMPurify',
        tag: 'Apache-2.0 / MPL-2.0',
      },
      { name: 'node-pty', url: 'https://github.com/microsoft/node-pty', tag: 'MIT' },
      { name: 'smol-toml', url: 'https://github.com/squirrelsmile/smol-toml', tag: 'MIT' },
      { name: 'tar-stream', url: 'https://github.com/mafintosh/tar-stream', tag: 'MIT' },
      { name: 'yauzl', url: 'https://github.com/thejoshwolfe/yauzl', tag: 'MIT' },
      { name: 'tree-kill', url: 'https://github.com/pkrumins/node-tree-kill', tag: 'MIT' },
    ],
  },
  {
    id: 'ecosystem',
    icon: 'smart_toy',
    title: '生态项目',
    items: [
      {
        name: 'MoFox (Neo-MoFox)',
        url: 'https://github.com/MoFox-Studio/Neo-MoFox',
        tag: 'QQ 机器人',
      },
      { name: 'NapCat', url: 'https://github.com/NapNeko/NapCatQQ', tag: 'OneBot 11' },
      { name: 'SnowLuma', url: 'https://github.com/SnowLuma/SnowLuma', tag: 'OneBot 11' },
    ],
  },
  {
    id: 'services',
    icon: 'cloud',
    title: '服务与镜像',
    items: [
      { name: 'GitHub', url: 'https://github.com/', tag: '发行版分发' },
      { name: 'GitHub Proxy', url: 'https://ghproxy.net/', tag: '下载加速' },
      { name: 'PyPI', url: 'https://pypi.org/', tag: 'Python 包索引' },
      { name: '清华 TUNA 镜像站', url: 'https://mirrors.tuna.tsinghua.edu.cn/', tag: 'PyPI 镜像' },
      { name: '阿里云开源镜像站', url: 'https://developer.aliyun.com/mirror/', tag: 'PyPI 镜像' },
      { name: '中科大镜像站', url: 'https://mirrors.ustc.edu.cn/', tag: 'PyPI 镜像' },
      { name: '腾讯云开源镜像站', url: 'https://mirrors.cloud.tencent.com/', tag: 'PyPI 镜像' },
      { name: '华为云镜像站', url: 'https://repo.huaweicloud.com/', tag: 'Python 镜像' },
    ],
  },
];
</script>

<template>
  <div class="settings-group">
    <!-- ═══ 关于主视图 ═══ -->
    <template v-if="aboutView === 'about'">
      <!-- 版本与更新 -->
      <section class="settings-group__card">
        <div class="settings-group__heading">
          <span class="msr">info</span>
          <div>
            <h2>关于</h2>
            <p>版本与更新信息</p>
          </div>
        </div>
        <div class="settings-group__body">
          <div class="settings-item">
            <span class="msr settings-item__icon">rocket_launch</span>
            <div class="settings-item__body">
              <span class="settings-item__label">Neo-MoFox Launcher</span>
              <span class="settings-item__desc settings-item__desc--mono">
                {{ versionLine }}
              </span>
              <span v-if="channelLabel" class="about-channel-badge">{{ channelLabel }}</span>
            </div>
            <button class="text-button state-layer" :disabled="checking" @click="handleCheckUpdate">
              {{ checking ? '检查中…' : '检查更新' }}
            </button>
          </div>

          <!-- 检查失败就地提示；启动自动检查的失败保持静默，不在此重复打扰 -->
          <div v-if="lastError" class="settings-note settings-note--error">
            <span class="msr settings-note__icon">error</span>
            <span>检查更新失败：{{ lastError }}</span>
          </div>

          <!-- 可用更新：发行说明 + 前往发布页 -->
          <template v-if="updateInfo">
            <div class="settings-item about-update-item">
              <span class="msr settings-item__icon about-update-item__icon">
                system_update_alt
              </span>
              <div class="settings-item__body">
                <span class="settings-item__label">
                  发现新版本 {{ updateInfo.latestVersion }}
                </span>
                <span class="settings-item__desc">{{ releaseDateLine }}</span>
              </div>
              <button class="text-button state-layer" @click="openReleasePage">前往发布页</button>
            </div>
            <div v-if="releaseNotesHtml" class="about-release-notes" @click="handleNotesClick">
              <!-- 内容来自 GitHub Release，已经 renderRemoteMarkdown 净化，仅保留白名单标签 -->
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="about-release-notes__body" v-html="releaseNotesHtml"></div>
            </div>
          </template>

          <div class="settings-item">
            <span class="msr settings-item__icon">description</span>
            <div class="settings-item__body">
              <span class="settings-item__desc">基于 Electron · Vue 3 · Material Design 3</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 致谢：导语与跳转入口同卡，名单与开源列表在面板内切换展示 -->
      <section class="settings-group__card">
        <div class="settings-group__heading">
          <span class="msr">volunteer_activism</span>
          <div>
            <h2>致谢</h2>
            <p>感谢每一位支持和帮助过启动器的朋友</p>
          </div>
        </div>
        <div class="settings-group__body">
          <p class="about-thanks-note">
            Neo-MoFox Launcher
            的成长离不开社区的支持——无论是参与设计与开发、反馈使用问题、测试每夜构建，还是向身边的朋友推荐启动器，每一份帮助都值得被记住，在此一并致谢。
          </p>
          <button type="button" class="about-jump-item state-layer" @click="openSubView('people')">
            <span class="msr settings-item__icon">volunteer_activism</span>
            <div class="settings-item__body">
              <span class="settings-item__label">致谢人物</span>
              <span class="settings-item__desc">核心维护与贡献支持的朋友名单</span>
            </div>
            <span class="msr about-jump-item__chevron" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" class="about-jump-item state-layer" @click="openSubView('oss')">
            <span class="msr settings-item__icon">extension</span>
            <div class="settings-item__body">
              <span class="settings-item__label">开源致谢</span>
              <span class="settings-item__desc">依赖的开源项目、生态项目与镜像服务</span>
            </div>
            <span class="msr about-jump-item__chevron" aria-hidden="true">chevron_right</span>
          </button>
        </div>
      </section>

      <!-- 开源协议 -->
      <section class="settings-group__card">
        <div class="settings-group__heading">
          <span class="msr">gavel</span>
          <div>
            <h2>开源协议</h2>
            <p>许可与版权信息</p>
          </div>
        </div>
        <div class="settings-group__body">
          <div class="settings-item">
            <span class="msr settings-item__icon">license</span>
            <div class="settings-item__body">
              <span class="settings-item__label">GNU AGPL v3.0</span>
              <span class="settings-item__desc">
                本项目基于 GNU Affero General Public License v3.0
                协议开源分发，可自由使用、修改与再分发，需遵守协议的相应义务
              </span>
            </div>
          </div>
          <div class="settings-item">
            <span class="msr settings-item__icon">open_in_new</span>
            <div class="settings-item__body">
              <span class="settings-item__label">查看协议全文与源代码</span>
              <span class="settings-item__desc">
                许可协议随源代码一同发布；第三方组件遵循其自身的开源协议
              </span>
            </div>
            <button class="text-button state-layer" @click="openExternalUrl(LICENSE_URL)">
              许可协议
            </button>
            <button class="text-button state-layer" @click="openExternalUrl(REPOSITORY_URL)">
              源代码仓库
            </button>
          </div>
        </div>
      </section>
    </template>

    <!-- ═══ 致谢人物名单视图 ═══ -->
    <template v-else-if="aboutView === 'people'">
      <header ref="subViewHeader" class="about-subview-header">
        <button
          class="about-subview-header__back state-layer"
          type="button"
          title="返回"
          aria-label="返回"
          @click="backToAbout"
        >
          <span class="msr" aria-hidden="true">arrow_back</span>
        </button>
        <div>
          <h2 class="about-subview-header__title">致谢</h2>
          <p class="about-subview-header__subtitle">核心维护与贡献支持的朋友名单</p>
        </div>
      </header>

      <section
        v-for="category in CREDIT_CATEGORIES"
        :key="category.id"
        class="settings-group__card"
      >
        <div class="settings-group__heading">
          <span class="msr">{{ PEOPLE_CATEGORY_ICONS[category.id] ?? 'group' }}</span>
          <div>
            <h2>{{ category.title }}</h2>
            <p>{{ category.description }}</p>
          </div>
        </div>
        <div class="settings-group__body">
          <div class="about-people__list">
            <button
              v-for="credit in category.entries"
              :key="credit.username"
              type="button"
              class="about-credit-person state-layer"
              @click="openExternalUrl(credit.profileUrl)"
            >
              <span class="about-credit-avatar">
                <img
                  v-if="!avatarFailures.has(credit.username)"
                  :src="credit.avatarUrl"
                  :alt="`${credit.name} 的 GitHub 头像`"
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  @error="markAvatarFailed(credit.username)"
                />
                <span v-else class="about-credit-avatar__fallback">
                  {{ avatarFallback(credit.name) }}
                </span>
              </span>
              <span class="about-credit-person__body">
                <span class="about-credit-person__name">{{ credit.name }}</span>
                <span class="about-credit-person__username">@{{ credit.username }}</span>
                <span class="about-credit-person__note">{{ credit.note }}</span>
              </span>
            </button>
          </div>
        </div>
      </section>

      <p class="about-credits-footnote">
        名单不分先后；如有遗漏或信息需要更正，欢迎通过 GitHub 联系我们。
      </p>
    </template>

    <!-- ═══ 开源致谢长列表视图 ═══ -->
    <template v-else>
      <header ref="subViewHeader" class="about-subview-header">
        <button
          class="about-subview-header__back state-layer"
          type="button"
          title="返回"
          aria-label="返回"
          @click="backToAbout"
        >
          <span class="msr" aria-hidden="true">arrow_back</span>
        </button>
        <div>
          <h2 class="about-subview-header__title">开源致谢</h2>
          <p class="about-subview-header__subtitle">依赖的开源项目、生态项目与服务</p>
        </div>
      </header>

      <section v-for="group in CREDIT_GROUPS" :key="group.id" class="settings-group__card">
        <div class="settings-group__heading">
          <span class="msr">{{ group.icon }}</span>
          <div>
            <h2>{{ group.title }}</h2>
            <p>{{ group.items.length }} 个项目与服务</p>
          </div>
        </div>
        <div class="settings-group__body">
          <div class="about-credits">
            <button
              v-for="item in group.items"
              :key="`${group.id}-${item.name}`"
              type="button"
              class="about-credit-chip state-layer"
              @click="openExternalUrl(item.url)"
            >
              <span>{{ item.name }}</span>
              <span class="about-credit-chip__tag">{{ item.tag }}</span>
            </button>
          </div>
        </div>
      </section>

      <p class="about-credits-footnote">
        感谢以上开源项目与服务提供方；相关版权归各自所有者所有，依照其自身许可提供。
      </p>
    </template>
  </div>
</template>

<style scoped>
/* 渠道徽标：小号胶囊，置于版本描述下方。 */
.about-channel-badge {
  align-self: flex-start;
  margin-top: 4px;
  padding: 1px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-primary) 14%, transparent);
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-label-small);
}

/* 更新提示行：用主色图标与浅色底强调“有新版本”。 */
.about-update-item {
  background: color-mix(in srgb, var(--md-sys-color-primary) 8%, var(--app-glass-row));
}

.about-update-item__icon {
  color: var(--md-sys-color-primary);
}

/* 发行说明容器：限高滚动，避免长说明撑爆设置卡片。 */
.about-release-notes {
  max-height: 340px;
  padding: 8px 18px 12px;
  overflow-y: auto;
}

.about-release-notes__body {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.about-release-notes__body :deep(h1),
.about-release-notes__body :deep(h2),
.about-release-notes__body :deep(h3),
.about-release-notes__body :deep(h4) {
  margin: 0.8em 0 0.4em;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-medium);
}

.about-release-notes__body :deep(h1:first-child),
.about-release-notes__body :deep(h2:first-child) {
  margin-top: 0.2em;
}

.about-release-notes__body :deep(p) {
  margin: 0.4em 0;
}

.about-release-notes__body :deep(ul),
.about-release-notes__body :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.4em;
}

.about-release-notes__body :deep(blockquote) {
  margin: 0.6em 0;
  padding: 0.2em 0.9em;
  border-left: 3px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}

.about-release-notes__body :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  font-family: var(--md-ref-typeface-mono);
  font-size: 0.9em;
}

.about-release-notes__body :deep(pre) {
  margin: 0.5em 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  overflow-x: auto;
}

.about-release-notes__body :deep(pre code) {
  padding: 0;
  background: transparent;
}

.about-release-notes__body :deep(table) {
  margin: 0.5em 0;
  border-collapse: collapse;
}

.about-release-notes__body :deep(th),
.about-release-notes__body :deep(td) {
  padding: 4px 10px;
  border: 1px solid var(--md-sys-color-outline-variant);
}

.about-release-notes__body :deep(a) {
  color: var(--md-sys-color-primary);
}

/* ── 致谢导语 ── */
.about-thanks-note {
  margin: 0;
  padding: 2px 8px 6px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

/* ── 致谢人物 ── */
.about-people__list {
  padding: 6px 8px 8px 48px;
  display: grid;
  gap: 6px;
}

/* 人物条目：头像 + 名称 + 一句话说明，点击打开 GitHub 主页。 */
.about-credit-person {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: var(--app-glass-row);
  color: inherit;
  text-align: left;
  cursor: pointer;
  position: relative;
}

.about-credit-avatar {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: var(--md-sys-shape-corner-full);
  overflow: hidden;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--md-sys-color-primary) 14%, transparent);
  color: var(--md-sys-color-primary);
  font: var(--md-sys-typescale-title-medium);
}

.about-credit-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.about-credit-avatar__fallback {
  line-height: 1;
}

.about-credit-person__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.about-credit-person__name {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
}

.about-credit-person__username {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
  font-family: var(--md-ref-typeface-mono);
}

.about-credit-person__note {
  margin-top: 2px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

/* ── 开源致谢跳转卡片 ── */
.about-jump-item {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-height: var(--app-density-row-min-height);
  padding: var(--app-density-row-padding-block) 18px;
  border: none;
  border-radius: 7px;
  background: var(--app-glass-row);
  color: inherit;
  text-align: left;
  cursor: pointer;
  position: relative;
}

.about-jump-item__chevron {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 24px;
}

/* 导语段与跳转行同卡时，首行跳转按钮沿用卡片大圆角。 */
.about-thanks-note + .about-jump-item {
  border-radius: 18px 18px 7px 7px;
}

/* ── 面板内子列表视图（致谢人物 / 开源致谢）── */
.about-subview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 0;
  scroll-margin-top: 16px;
}

.about-subview-header__back {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  cursor: pointer;
  position: relative;
}

.about-subview-header__title {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
}

.about-subview-header__subtitle {
  margin: 2px 0 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

.about-credits {
  padding: 8px 8px 8px 48px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.about-credit-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--app-glass-border);
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--app-glass-row);
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-small);
  cursor: pointer;
  position: relative;
}

.about-credit-chip__tag {
  padding: 1px 7px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-label-small);
  white-space: nowrap;
}

.about-credits-footnote {
  margin: 0;
  padding: 0 4px;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

@media (max-width: 680px) {
  .about-people__list,
  .about-credits {
    padding-left: 8px;
  }
}
</style>

<style scoped src="./settings-panel.css"></style>
