import { ref } from 'vue';
import type { LauncherBuildInfo, LauncherUpdateInfo } from '@shared/domain/app-update';
import { mofoxApi } from '@/services/mofox-api';
import { showToast } from '@/composables/use-toast';

/**
 * 启动器自身更新的共享状态：关于面板与启动自动检查共用同一份数据，
 * 避免两个入口各自重复请求或状态不同步。模块级单例与 use-toast 保持一致。
 */

/** 本地构建信息；读取失败时保持 null，界面显示占位文案。 */
const buildInfo = ref<LauncherBuildInfo | null>(null);
/** 远端检查进行中标记，防止按钮重复触发。 */
const checking = ref(false);
/** 最近一次检查发现的可用更新；无更新或未检查过时为 null。 */
const updateInfo = ref<LauncherUpdateInfo | null>(null);
/** 最近一次检查的失败原因；成功后清空，供关于面板就地展示。 */
const lastError = ref<string | null>(null);

/** 把任意抛出的错误收敛为可读文案。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '未知错误';
}

/** 读取本地构建信息；已加载或正在加载时跳过重复请求。 */
async function loadBuildInfo(): Promise<void> {
  if (buildInfo.value) return;
  try {
    buildInfo.value = await mofoxApi.getLauncherBuildInfo();
  } catch (error) {
    lastError.value = describeError(error);
  }
}

/**
 * 执行一次远端更新检查。
 *
 * @param options.silent - 静默模式：供启动自动检查使用，仅在发现更新时弹 toast，失败不打扰；
 *   手动检查（关于面板）则相反——发现更新时结果已就地展示，不再弹 toast。
 * @returns 检查结果；进行中或失败时返回 null。
 */
async function checkForUpdates(
  options: { silent?: boolean } = {},
): Promise<LauncherUpdateInfo | null> {
  if (checking.value) return null;
  checking.value = true;
  lastError.value = null;
  try {
    const info = await mofoxApi.checkLauncherUpdate();
    updateInfo.value = info.updateAvailable ? info : null;
    if (info.updateAvailable) {
      // 启动自动检查只在发现更新时提示；手动检查的更新信息已在关于面板就地展示，无需重复打扰。
      if (options.silent) {
        showToast(`发现新版本 ${info.latestVersion}，可在「设置 → 关于」查看更新说明`, {
          duration: 6000,
        });
      }
    } else if (!options.silent) {
      showToast('当前已是最新版本');
    }
    return info;
  } catch (error) {
    lastError.value = describeError(error);
    if (!options.silent) showToast(`检查更新失败：${lastError.value}`);
    return null;
  } finally {
    checking.value = false;
  }
}

/**
 * 启动时的自动检查：仅在设置开启时执行；反馈全部静默，
 * 检查到有更新时弹出轻提示，失败不打扰启动流程。
 *
 * @param enabled - 「自动检查更新」设置的当前值。
 */
async function autoCheckOnStartup(enabled: boolean): Promise<void> {
  if (!enabled) return;
  await checkForUpdates({ silent: true });
}

export function useLauncherUpdate() {
  return {
    buildInfo,
    checking,
    updateInfo,
    lastError,
    loadBuildInfo,
    checkForUpdates,
    autoCheckOnStartup,
  };
}
