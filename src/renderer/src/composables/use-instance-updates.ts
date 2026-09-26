import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Instance } from '@shared/domain/instance';
import type { SystemEnvInfo } from '@shared/domain/system-env';
import type {
  MofoxUpdateInfo,
  PlatformUpdateInfo,
  UpdateProgressEvent,
} from '@shared/domain/update';
import { mofoxApi } from '@/services/mofox-api';

export function useInstanceUpdates(
  props: { instance: Instance },
  /** 轻提示回调：由调用方注入（通常来自全局 useToast）。 */
  showToast: (message: string) => void,
) {
  // 更新面板：用一个连续任务画布承载目标切换、版本状态与更新操作。
  // 仅提交历史这类长列表保留局部滚动，页面本身由实例管理画布统一滚动。
  type UpdateTarget = 'mofox' | 'platform';

  // 更新失败时弹出的应用内错误框；`stack` 可选，仅 Error 实例携带。
  interface UpdateErrorState {
    title: string;
    description: string;
    stack?: string;
  }

  const MOFOX_REPOSITORY_URL = 'https://github.com/MoFox-Studio/Neo-MoFox';

  const errorDialog = ref<UpdateErrorState | null>(null);

  // 打开错误弹窗；空标题按“更新失败”兜底，非 Error 值字符串化后展示。
  function showUpdateError(title: string, error: unknown): void {
    errorDialog.value = {
      title: title || '更新失败',
      description: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    };
  }

  function openRepository(): void {
    void mofoxApi.openExternal(MOFOX_REPOSITORY_URL);
  }

  const target = ref<UpdateTarget>('mofox');
  const mofoxInfo = ref<MofoxUpdateInfo | null>(null);
  const platformInfo = ref<PlatformUpdateInfo | null>(null);
  const loadingMofox = ref(false);
  const loadingPlatform = ref(false);
  const switchingBranch = ref(false);
  const checkingOut = ref(false);
  const updatingMofox = ref(false);
  const updatingPlatform = ref(false);
  const selectedBranch = ref('');
  const env = ref<SystemEnvInfo | null>(null);

  // 最新进度消息：任何进行中的更新操作都驱动顶部进度条。
  const progress = ref<UpdateProgressEvent | null>(null);
  const busy = computed(
    () =>
      switchingBranch.value || checkingOut.value || updatingMofox.value || updatingPlatform.value,
  );

  let unsubscribeProgress: (() => void) | null = null;

  const mofoxBranches = computed(() => mofoxInfo.value?.branches ?? []);
  const mofoxCommits = computed(() => mofoxInfo.value?.commits ?? []);
  const hasMofoxUpdate = computed(() => mofoxInfo.value?.hasUpdate ?? false);

  const releases = computed(() => platformInfo.value?.releases ?? []);
  const platformInstalled = computed(() => platformInfo.value?.installed ?? false);
  const platformCurrentVersion = computed(() => platformInfo.value?.currentVersion ?? null);

  function formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  async function refreshMofox(): Promise<void> {
    loadingMofox.value = true;
    try {
      mofoxInfo.value = await mofoxApi.getMofoxUpdateInfo(props.instance.id);
      if (!selectedBranch.value && mofoxInfo.value.branch) {
        selectedBranch.value = mofoxInfo.value.branch;
      }
    } catch (error) {
      showToast(
        `主程序版本信息加载失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      loadingMofox.value = false;
    }
  }

  async function refreshPlatform(): Promise<void> {
    loadingPlatform.value = true;
    try {
      platformInfo.value = await mofoxApi.getPlatformUpdateInfo(props.instance.id);
    } catch (error) {
      showToast(`平台版本信息加载失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      loadingPlatform.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([refreshMofox(), refreshPlatform()]);
  }

  function onBranchChange(event: Event): void {
    selectedBranch.value = (event.target as HTMLSelectElement).value;
  }

  async function doSwitchBranch(): Promise<void> {
    if (switchingBranch.value || !selectedBranch.value) return;
    switchingBranch.value = true;
    try {
      mofoxInfo.value = await mofoxApi.switchMofoxBranch(props.instance.id, selectedBranch.value);
      showToast(`已切换到分支 ${selectedBranch.value}`);
    } catch (error) {
      showUpdateError('分支切换失败', error);
    } finally {
      switchingBranch.value = false;
      progress.value = null;
    }
  }

  async function doCheckout(commitHash: string): Promise<void> {
    if (checkingOut.value) return;
    checkingOut.value = true;
    try {
      mofoxInfo.value = await mofoxApi.checkoutMofoxCommit(props.instance.id, commitHash);
      showToast(`已回退到提交 ${commitHash}`);
    } catch (error) {
      showUpdateError('回退失败', error);
    } finally {
      checkingOut.value = false;
      progress.value = null;
    }
  }

  async function doUpdateMofox(): Promise<void> {
    if (updatingMofox.value) return;
    updatingMofox.value = true;
    try {
      mofoxInfo.value = await mofoxApi.updateMofox(props.instance.id);
      showToast('主程序已更新到最新提交');
    } catch (error) {
      showUpdateError('主程序更新失败', error);
    } finally {
      updatingMofox.value = false;
      progress.value = null;
    }
  }

  async function doUpdatePlatform(version: string): Promise<void> {
    if (updatingPlatform.value) return;
    updatingPlatform.value = true;
    try {
      platformInfo.value = await mofoxApi.updatePlatform(props.instance.id, version);
      showToast(version ? `平台已更改到 ${version}` : '平台已更新到最新版本');
    } catch (error) {
      showUpdateError('平台更新失败', error);
    } finally {
      updatingPlatform.value = false;
      progress.value = null;
    }
  }

  onMounted(() => {
    void refresh();
    // 探测更新依赖（git / uv / python）版本，用于更新页诊断展示。
    void mofoxApi
      .detectSystemEnv()
      .then((value) => {
        env.value = value;
      })
      .catch(() => undefined);
    // 只接收当前实例的更新进度，驱动顶部进度条与操作中的提示文本。
    unsubscribeProgress = mofoxApi.on('update-progress', (event) => {
      if (event.instanceId !== props.instance.id) return;
      if (event.error) {
        progress.value = null;
        showUpdateError('更新失败', new Error(event.error));
        return;
      }
      if (event.percent >= 1) {
        progress.value = null;
        return;
      }
      progress.value = event;
    });
  });

  onBeforeUnmount(() => {
    unsubscribeProgress?.();
  });

  return {
    errorDialog,
    target,
    mofoxInfo,
    platformInfo,
    loadingMofox,
    loadingPlatform,
    switchingBranch,
    checkingOut,
    updatingMofox,
    updatingPlatform,
    selectedBranch,
    env,
    progress,
    busy,
    mofoxBranches,
    mofoxCommits,
    hasMofoxUpdate,
    releases,
    platformInstalled,
    platformCurrentVersion,
    formatDate,
    refresh,
    refreshMofox,
    refreshPlatform,
    onBranchChange,
    doSwitchBranch,
    doCheckout,
    doUpdateMofox,
    doUpdatePlatform,
    openRepository,
  };
}
