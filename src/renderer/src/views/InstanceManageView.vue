<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import type { InstalledPlatform } from '@shared/domain/instance';
import { useInstancesStore } from '@/stores/instances';
import { mofoxApi } from '@/services/mofox-api';
import { useWindowTitle } from '@/composables/use-window-title';
import StatusBadge from '@/components/StatusBadge.vue';
import BaseDialog from '@/components/BaseDialog.vue';

type ManageTab = 'info' | 'more';

// 实例管理页：侧边栏只保留信息查看与更多两个分区，布局参考设置页。
// 更多分区收纳文件系统操作，实例信息修改通过弹窗完成。
const route = useRoute();
const router = useRouter();
const instancesStore = useInstancesStore();

const instanceId = computed(() => String(route.params.id ?? ''));
const instance = computed(() => instancesStore.byId(instanceId.value));

// 页面标题跟随实例名称与运行状态展示在窗口栏。
useWindowTitle({ title: () => instance.value?.name ?? '实例管理', subtitle: '实例管理' });

const NAV_ITEMS: { id: ManageTab; label: string; description: string; icon: string }[] = [
  { id: 'info', label: '信息查看', description: '实例的运行状态与目录信息', icon: 'info' },
  { id: 'more', label: '更多', description: '文件系统操作与实例信息修改', icon: 'more_horiz' },
];

const activeTab = ref<ManageTab>('info');

// 基础信息修改表单，仅在修改弹窗打开时临时持有。
const editOpen = ref(false);
const mofoxDir = ref('');
const platformId = ref('');
const platformDir = ref('');
const autoStart = ref(false);

const platforms = ref<BotPlatformMetadata[]>([]);
const platformOptionsLoading = ref(false);
const saving = ref(false);
const validating = ref(false);
const toast = ref('');
const pendingRemove = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

// 校验只发生在按下保存时，错误内联显示在对应字段下；输入过程不做即时判断。
const mofoxDirError = ref('');
const platformDirError = ref('');
const checkingMofoxDir = ref(false);
const checkingPlatformDir = ref(false);

const showMofoxDirError = computed(() => mofoxDirError.value !== '');
const showPlatformDirError = computed(() => platformDirError.value !== '');

// 平台选项与选中值必须在同一次渲染同时就绪，否则 Material 下拉框不会展示已选值；
// key 在选项加载完成后变化，强制下拉框携带选项与值一起重建。
const platformSelectKey = computed(() => (platformOptionsLoading.value ? 'loading' : 'ready'));

const platformLabel = computed(() => {
  const id = platformId.value;
  if (!id) return '未安装';
  return platforms.value.find((p) => p.id === id)?.name ?? id;
});

function formatDate(value: number | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function syncForm(): void {
  if (!instance.value) return;
  mofoxDir.value = instance.value.mofoxInstallDir;
  platformId.value = instance.value.platform?.id ?? '';
  platformDir.value = instance.value.platform?.installDir ?? '';
  autoStart.value = instance.value.autoStart;
}

// 弹窗打开时保留用户的编辑内容，实例变化只在弹窗关闭时回填。
watch(instance, () => {
  if (editOpen.value) return;
  syncForm();
});

function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 2600);
}

onMounted(async () => {
  await instancesStore.refresh();
  if (!instance.value) {
    void router.replace({ name: 'instances' });
    return;
  }
  syncForm();
  platformOptionsLoading.value = true;
  try {
    platforms.value = await mofoxApi.listBotPlatforms();
  } catch (error) {
    showToast(`平台列表加载失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    platformOptionsLoading.value = false;
  }
});

onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer);
});

function openEditDialog(): void {
  syncForm();
  mofoxDirError.value = '';
  platformDirError.value = '';
  editOpen.value = true;
}

function closeEditDialog(): void {
  editOpen.value = false;
}

function onPlatformChange(event: Event): void {
  platformId.value = (event.target as HTMLSelectElement).value;
  // 平台种类切换后旧平台路径不再有效，必须清空等待用户重新指定。
  platformDir.value = '';
  platformDirError.value = '';
}

// 校验结果在输入框再次获得焦点时清除，避免用户在修改过程中仍看到旧错误。
function onMofoxDirFocus(): void {
  mofoxDirError.value = '';
}

function onPlatformDirFocus(): void {
  platformDirError.value = '';
}

async function validateMofoxDir(): Promise<boolean> {
  const value = mofoxDir.value.trim();
  if (!value) {
    mofoxDirError.value = '主程序路径不能为空';
    return false;
  }
  mofoxDirError.value = '';
  checkingMofoxDir.value = true;
  try {
    const check = await mofoxApi.inspectImportPath(value);
    if (!check.absolute) mofoxDirError.value = '请输入绝对路径';
    else if (!check.exists) mofoxDirError.value = '目录不存在';
    else if (!check.isDirectory) mofoxDirError.value = '必须是目录';
    else if (!check.mainPyExists)
      mofoxDirError.value = '不是有效的 Neo-MoFox 安装目录（缺少 main.py）';
  } catch {
    mofoxDirError.value = '目录校验失败，请稍后重试';
  } finally {
    checkingMofoxDir.value = false;
  }
  return mofoxDirError.value === '';
}

async function validatePlatformDir(): Promise<boolean> {
  if (!platformId.value) return true;
  const value = platformDir.value.trim();
  if (!value) {
    platformDirError.value = '平台安装目录不能为空';
    return false;
  }
  platformDirError.value = '';
  checkingPlatformDir.value = true;
  try {
    const check = await mofoxApi.inspectPlatformImportPath(platformId.value, value);
    if (!check.absolute) platformDirError.value = '请输入绝对路径';
    else if (!check.exists) platformDirError.value = '目录不存在';
    else if (!check.isDirectory) platformDirError.value = '必须是目录';
    else if (!check.valid) platformDirError.value = '不是有效的平台安装目录';
  } catch {
    platformDirError.value = '目录校验失败，请稍后重试';
  } finally {
    checkingPlatformDir.value = false;
  }
  return platformDirError.value === '';
}

async function browseDirectory(target: 'mofox' | 'platform'): Promise<void> {
  const defaultPath =
    target === 'mofox' ? mofoxDir.value || undefined : platformDir.value || undefined;
  const picked = await mofoxApi.pickDirectory({
    title: target === 'mofox' ? '选择 MoFox 安装目录' : '选择平台安装目录',
    defaultPath,
  });
  if (!picked) return;
  if (target === 'mofox') mofoxDir.value = picked;
  else platformDir.value = picked;
}

function openFolder(): void {
  void mofoxApi.openInstanceFolder(instanceId.value);
}

function openLogs(): void {
  void router.push({ name: 'instance-logs', params: { id: instanceId.value } });
}

function goBack(): void {
  router.back();
}

// 自动运行开关即时持久化，不依赖修改弹窗的保存按钮。
async function toggleAutoStart(): Promise<void> {
  if (!instance.value) return;
  const next = !autoStart.value;
  autoStart.value = next;
  try {
    await instancesStore.update(instanceId.value, { autoStart: next });
    showToast(next ? '已开启自动运行' : '已关闭自动运行');
  } catch (error) {
    autoStart.value = !next;
    showToast(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requestRemove(): void {
  pendingRemove.value = true;
}

function cancelRemove(): void {
  pendingRemove.value = false;
}

async function confirmRemove(): Promise<void> {
  if (!instance.value) return;
  await instancesStore.remove(instance.value.id);
  pendingRemove.value = false;
  void router.replace({ name: 'instances' });
}

async function save(): Promise<void> {
  if (!instance.value || saving.value || validating.value) return;
  // 先校验路径再提交；任一字段失败都留在弹窗内联报错，不进入保存。
  validating.value = true;
  try {
    const mofoxValid = await validateMofoxDir();
    const platformValid = await validatePlatformDir();
    if (!mofoxValid || !platformValid) return;
  } finally {
    validating.value = false;
  }
  saving.value = true;
  try {
    const currentPlatform = instance.value.platform;
    const platformChanged = platformId.value !== (currentPlatform?.id ?? '');
    // 平台种类变化时旧版本号不再可信，置空；仅改路径时保留原版本。
    const platform: InstalledPlatform | null = platformId.value
      ? {
          id: platformId.value,
          installDir: platformDir.value,
          version: platformChanged ? null : (currentPlatform?.version ?? null),
        }
      : null;
    await instancesStore.update(instanceId.value, {
      mofoxInstallDir: mofoxDir.value,
      platform,
    });
    editOpen.value = false;
    syncForm();
    showToast('实例配置已保存');
  } catch (error) {
    showToast(`保存失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="manage-view">
    <!-- 侧边栏分区导航；底部常驻日志入口 -->
    <aside class="manage-sidebar">
      <nav class="manage-sidebar__nav" aria-label="实例管理分区">
        <button
          v-for="item in NAV_ITEMS"
          :key="item.id"
          class="manage-sidebar__item state-layer"
          :class="{ 'manage-sidebar__item--active': activeTab === item.id }"
          type="button"
          :aria-current="activeTab === item.id ? 'page' : undefined"
          @click="activeTab = item.id"
        >
          <span
            class="msr manage-sidebar__icon"
            :class="{ 'msr--fill': activeTab === item.id }"
            aria-hidden="true"
          >
            {{ item.icon }}
          </span>
          <span class="manage-sidebar__text">
            <span class="manage-sidebar__label">{{ item.label }}</span>
            <span class="manage-sidebar__description">{{ item.description }}</span>
          </span>
        </button>
      </nav>

      <div class="manage-sidebar__footer">
        <button class="manage-sidebar__action state-layer" type="button" @click="openLogs">
          <span class="msr manage-sidebar__icon" aria-hidden="true">terminal</span>
          <span class="manage-sidebar__text">
            <span class="manage-sidebar__label">查看日志</span>
            <span class="manage-sidebar__description">查看运行日志与终端输出</span>
          </span>
        </button>
      </div>
    </aside>

    <!-- 信息查看：实例名称、状态与只读元数据都集中在本区域 -->
    <main class="manage-content">
      <section v-if="activeTab === 'info'" class="manage-group">
        <div class="manage-info__head">
          <button
            class="icon-btn state-layer"
            type="button"
            title="返回"
            aria-label="返回"
            @click="goBack"
          >
            <span class="msr" aria-hidden="true">arrow_back</span>
          </button>
          <div class="manage-info__title">
            <h2 class="manage-info__name">{{ instance?.name ?? '实例管理' }}</h2>
            <StatusBadge v-if="instance" :status="instance.status" />
          </div>
        </div>

        <div class="manage-group__body">
          <dl v-if="instance" class="info-grid">
            <div class="info-grid__item">
              <dt>实例 ID</dt>
              <dd class="info-grid__value--mono">{{ instance.id }}</dd>
            </div>
            <div class="info-grid__item">
              <dt>运行状态</dt>
              <dd><StatusBadge :status="instance.status" /></dd>
            </div>
            <div class="info-grid__item">
              <dt>创建时间</dt>
              <dd>{{ formatDate(instance.createdAt) }}</dd>
            </div>
            <div class="info-grid__item">
              <dt>最后启动</dt>
              <dd>{{ formatDate(instance.lastStartedAt) }}</dd>
            </div>
            <div class="info-grid__item">
              <dt>MoFox 安装目录</dt>
              <dd class="info-grid__value--mono">{{ instance.mofoxInstallDir || '—' }}</dd>
            </div>
            <div class="info-grid__item">
              <dt>平台种类</dt>
              <dd>{{ instance.platform?.id ?? '未安装' }}</dd>
            </div>
            <div class="info-grid__item">
              <dt>平台安装目录</dt>
              <dd class="info-grid__value--mono">{{ instance.platform?.installDir || '—' }}</dd>
            </div>
            <div class="info-grid__item">
              <dt>平台版本</dt>
              <dd>{{ instance.platform?.version || '—' }}</dd>
            </div>
            <div class="info-grid__item">
              <dt>启动时自动运行</dt>
              <dd>{{ instance.autoStart ? '是' : '否' }}</dd>
            </div>
          </dl>
          <p v-else class="manage-group__empty">实例不存在或已被删除。</p>
        </div>
      </section>

      <!-- 更多：文件系统操作、自动启动与实例信息修改入口 -->
      <section v-else class="manage-group">
        <div class="manage-group__head">
          <h2 class="manage-group__title">更多</h2>
        </div>
        <div class="manage-group__body">
          <div class="action-list">
            <div class="settings-item">
              <span class="msr settings-item__icon" aria-hidden="true">tune</span>
              <div class="settings-item__body">
                <span class="settings-item__label">修改实例信息</span>
                <span class="settings-item__desc">修改平台种类与安装路径</span>
              </div>
              <button class="btn btn--tonal state-layer" type="button" @click="openEditDialog">
                修改
              </button>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-item">
              <span class="msr settings-item__icon" aria-hidden="true">folder_open</span>
              <div class="settings-item__body">
                <span class="settings-item__label">打开文件夹</span>
                <span class="settings-item__desc">在系统文件管理器中查看 MoFox 安装目录</span>
              </div>
              <button class="btn btn--tonal state-layer" type="button" @click="openFolder">
                打开文件夹
              </button>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-item">
              <span class="msr settings-item__icon settings-item__icon--danger" aria-hidden="true"
                >delete</span
              >
              <div class="settings-item__body">
                <span class="settings-item__label">删除实例</span>
                <span class="settings-item__desc">停止进程并删除实例文件夹，此操作无法撤销</span>
              </div>
              <button class="btn btn--danger state-layer" type="button" @click="requestRemove">
                删除
              </button>
            </div>

            <div class="settings-divider"></div>

            <div class="settings-item">
              <span class="msr settings-item__icon" aria-hidden="true">power</span>
              <div class="settings-item__body">
                <span class="settings-item__label">启动器启动时自动运行</span>
                <span class="settings-item__desc">应用启动后自动启动此实例</span>
              </div>
              <div
                class="md-switch"
                role="switch"
                :aria-checked="autoStart"
                :class="{ 'md-switch--checked': autoStart }"
                @click="toggleAutoStart"
              >
                <div class="md-switch__thumb"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- 修改实例信息弹窗：只允许修改平台种类与安装路径 -->
    <BaseDialog
      :open="editOpen"
      title="修改实例信息"
      :width="480"
      :dismissible="!saving && !validating"
      @close="closeEditDialog"
    >
      <form class="edit-form" @submit.prevent="save">
        <div class="form-group">
          <md-outlined-select
            :key="platformSelectKey"
            class="platform-select"
            label="平台种类"
            :value="platformId"
            :disabled="platformOptionsLoading"
            @change="onPlatformChange"
          >
            <!-- Material Web Components 使用原生具名插槽，而不是 Vue 模板插槽。 -->
            <!-- eslint-disable vue/no-deprecated-slot-attribute -->
            <md-select-option value="">
              <div slot="headline">不安装平台</div>
            </md-select-option>
            <md-select-option v-for="p in platforms" :key="p.id" :value="p.id">
              <div slot="headline">{{ p.name }}</div>
            </md-select-option>
            <!-- eslint-enable vue/no-deprecated-slot-attribute -->
          </md-outlined-select>
          <p class="field__support">
            当前平台：{{ platformLabel }}。切换平台种类后必须重新指定平台安装目录。
          </p>
        </div>

        <div class="form-group">
          <div class="form-row">
            <label class="field field--grow" :class="{ 'field--error': showMofoxDirError }">
              <input
                v-model="mofoxDir"
                class="field__input"
                type="text"
                placeholder=" "
                @focus="onMofoxDirFocus"
              />
              <span class="field__label">主程序路径</span>
            </label>
            <button
              class="icon-btn icon-btn--browse state-layer"
              type="button"
              title="浏览目录"
              aria-label="浏览 MoFox 安装目录"
              @click="browseDirectory('mofox')"
            >
              <span class="msr" aria-hidden="true">folder_open</span>
            </button>
          </div>
          <Transition name="field-error" mode="out-in">
            <p v-if="showMofoxDirError" key="error" class="field__support field__support--error">
              {{ mofoxDirError }}
            </p>
            <p v-else key="hint" class="field__support">
              <template v-if="checkingMofoxDir">正在校验目录…</template>
              <template v-else>Neo-MoFox 本体所在目录，运行时据此启动 main.py。</template>
            </p>
          </Transition>
        </div>

        <div class="form-group">
          <div class="form-row">
            <label class="field field--grow" :class="{ 'field--error': showPlatformDirError }">
              <input
                v-model="platformDir"
                class="field__input"
                type="text"
                placeholder=" "
                :disabled="!platformId"
                @focus="onPlatformDirFocus"
              />
              <span class="field__label">平台路径</span>
            </label>
            <button
              class="icon-btn icon-btn--browse state-layer"
              type="button"
              title="浏览目录"
              aria-label="浏览平台安装目录"
              :disabled="!platformId"
              @click="browseDirectory('platform')"
            >
              <span class="msr" aria-hidden="true">folder_open</span>
            </button>
          </div>
          <Transition name="field-error" mode="out-in">
            <p v-if="showPlatformDirError" key="error" class="field__support field__support--error">
              {{ platformDirError }}
            </p>
            <p v-else key="hint" class="field__support">
              <template v-if="checkingPlatformDir">正在校验目录…</template>
              <template v-else>平台适配器的安装目录；未选择平台时无需填写。</template>
            </p>
          </Transition>
        </div>
      </form>

      <template #actions>
        <button
          class="btn btn--text state-layer"
          type="button"
          :disabled="saving || validating"
          @click="closeEditDialog"
        >
          取消
        </button>
        <button
          class="btn btn--filled state-layer"
          type="button"
          :disabled="saving || validating"
          @click="save"
        >
          <span v-if="!saving && !validating" class="msr btn__icon" aria-hidden="true">save</span>
          {{ validating ? '正在校验…' : saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </BaseDialog>

    <!-- 删除必须二次确认；删除前会先停止进程并清理目录与记录 -->
    <BaseDialog :open="pendingRemove" title="删除实例" :width="320" @close="cancelRemove">
      <p v-if="instance" class="remove-dialog__body">
        确定要删除实例「{{ instance.name }}」吗？此操作会删除其文件夹且无法撤销。
      </p>
      <template #actions>
        <button class="btn btn--text state-layer" type="button" @click="cancelRemove">取消</button>
        <button class="btn btn--error state-layer" type="button" @click="confirmRemove">
          删除
        </button>
      </template>
    </BaseDialog>

    <transition name="toast">
      <div v-if="toast" class="manage-view__toast" role="status">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
/* 与设置页一致的双栏布局：左栏贴边玻璃导航，右侧独立内容画布并单独模糊。 */
.manage-view {
  --manage-sidebar-width: 240px;

  position: relative;
  height: 100%;
  display: grid;
  grid-template-columns: var(--manage-sidebar-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

/* 只为右侧内容铺设主画布，让侧栏能直接模糊桌面材质或应用壁纸。 */
.manage-view::before {
  position: absolute;
  z-index: 0;
  inset: 0 0 0 var(--manage-sidebar-width);
  background: var(--app-current-content-surface);
  backdrop-filter: var(--app-current-content-filter);
  -webkit-backdrop-filter: var(--app-current-content-filter);
  content: '';
  pointer-events: none;
}

.manage-sidebar,
.manage-content {
  position: relative;
  z-index: 1;
}

/* 贴边导航抽屉使用较轻的内嵌玻璃层，与设置页侧栏一致。 */
.manage-sidebar {
  grid-row: 1 / -1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 24px 12px 16px;
  border-right: 1px solid var(--app-glass-border);
  background: var(--app-subrail-surface);
  backdrop-filter: var(--app-subrail-filter);
  -webkit-backdrop-filter: var(--app-subrail-filter);
}

.manage-sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.manage-sidebar__item,
.manage-sidebar__action {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 16px;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.manage-sidebar__item--active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.manage-sidebar__action:hover {
  background: color-mix(in srgb, var(--md-sys-color-primary) 10%, transparent);
  color: var(--md-sys-color-primary);
}

.manage-sidebar__icon {
  flex: 0 0 auto;
  font-size: 24px;
}

.manage-sidebar__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.manage-sidebar__label {
  font: var(--md-sys-typescale-label-large);
}

.manage-sidebar__description {
  overflow: hidden;
  color: inherit;
  font: var(--md-sys-typescale-body-small);
  opacity: 0.72;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manage-sidebar__footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--app-glass-border);
}

.manage-content {
  grid-column: 2;
  width: 100%;
  min-width: 0;
  margin: 0 auto;
  padding: 20px 32px 64px;
  overflow-y: auto;
}

/* 内容分组卡片：玻璃表面 + 模糊，风格与设置页分组一致。 */
.manage-group {
  width: 100%;
  max-width: 824px;
  box-sizing: border-box;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--app-glass-border);
  border-radius: 20px;
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.manage-group__head {
  display: flex;
  align-items: center;
  padding: 16px 24px 0;
}

.manage-group__title {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
}

.manage-group__body {
  padding: 24px;
}

.manage-group__empty {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
}

/* 信息查看头部：返回、实例名称与状态徽标 */
.manage-info__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--app-glass-border);
}

.manage-info__title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.manage-info__name {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin: 0;
}

.info-grid__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-grid__item dt {
  font: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.info-grid__item dd {
  margin: 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface);
}

.info-grid__value--mono {
  font-family: var(--md-ref-typeface-mono);
}

.action-list {
  display: flex;
  flex-direction: column;
}

.settings-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 0;
}

.settings-item__icon {
  flex: none;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 20px;
}

.settings-item__icon--danger {
  color: var(--md-sys-color-error);
}

.settings-item__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-item__label {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
}

.settings-item__desc {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

.settings-divider {
  height: 1px;
  background: var(--md-sys-color-outline-variant);
}

.md-switch {
  position: relative;
  width: 52px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  border: 2px solid var(--md-sys-color-outline);
  cursor: pointer;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
  flex-shrink: 0;
}

.md-switch__thumb {
  position: absolute;
  top: 50%;
  left: 4px;
  width: 20px;
  height: 20px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-outline);
  transform: translateY(-50%);
  transition:
    left var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.md-switch--checked {
  background: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.md-switch--checked .md-switch__thumb {
  left: 24px;
  background: var(--md-sys-color-on-primary);
}

/* 修改弹窗内的表单 */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.platform-select {
  width: 100%;
}

.icon-btn--browse {
  flex: none;
  margin-top: 8px;
  width: 40px;
  height: 40px;
}

.remove-dialog__body {
  margin: 0;
}

/* 字段错误提示：淡入 + 轻微水平抖动的动效，与安装页保持一致。 */
.field-error-enter-active,
.field-error-leave-active {
  transition: opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-emphasized);
}

.field-error-enter-from,
.field-error-leave-to {
  opacity: 0;
}

.field-error-enter-active.field__support--error {
  animation: field-error-shake var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized);
}

@keyframes field-error-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  25% {
    transform: translateX(-4px);
  }
  50% {
    transform: translateX(4px);
  }
  75% {
    transform: translateX(-2px);
  }
}

.manage-view__toast {
  position: fixed;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  max-width: min(560px, calc(100% - 64px));
  padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  font: var(--md-sys-typescale-body-medium);
  box-shadow: var(--md-sys-elevation-level3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 30;
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.btn__icon {
  font-size: 18px;
}

.btn--filled {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.btn--tonal {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.btn--danger {
  background: color-mix(in srgb, var(--md-sys-color-error) 12%, transparent);
  color: var(--md-sys-color-error);
}

.btn--text {
  padding: 0 12px;
  background: transparent;
  color: var(--md-sys-color-primary);
}

.btn--error {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: grid;
  place-items: center;
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .md-switch,
  .md-switch__thumb,
  .toast-enter-active,
  .toast-leave-active,
  .field-error-enter-active,
  .field-error-leave-active {
    transition: opacity var(--md-sys-motion-duration-short2) var(--md-sys-motion-easing-standard);
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: translateX(-50%);
  }

  .field-error-enter-active.field__support--error {
    animation: none;
  }
}
</style>
