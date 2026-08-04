import { defineStore } from 'pinia';
import { ref } from 'vue';
import { mofoxApi } from '@/services/mofox-api';
import { MofoxError } from '@shared/domain/error';
import type { OobeDependencyStatus, OobeProgress } from '@shared/domain/oobe';

/**
 * OOBE 仓库：管理依赖安装进度、当前消息与最终状态。
 *
 * 进度事件由主进程通过 IPC 推送，仓库负责订阅并落地到本地状态以供组件渲染；
 * 安装失败时保存累积日志与错误对象，供错误弹窗展示。
 */
export const useOobeStore = defineStore('oobe', () => {
  const dependencies = ref<OobeDependencyStatus[]>([]);
  const phase = ref<OobeProgress['phase'] | 'idle'>('idle');
  const currentMessage = ref('');
  const currentProgress = ref(-1);
  const installing = ref(false);
  /** 累积日志行；随进度事件同步更新，失败时供错误弹窗展示。 */
  const logs = ref<string[]>([]);
  /** 安装失败时的错误对象；非失败态为 null。 */
  const installError = ref<MofoxError | null>(null);
  let unsubscribe: (() => void) | undefined;

  /** 订阅主进程的 OOBE 进度事件；首次调用后开始监听。 */
  function subscribe(): void {
    if (unsubscribe) return;
    unsubscribe = mofoxApi.on('oobe-progress', (event) => {
      phase.value = event.phase;
      currentMessage.value = event.message;
      currentProgress.value = event.progress;
      dependencies.value = event.dependencies;
      if (event.logs) logs.value = event.logs;
    });
  }

  /** 释放进度事件订阅，避免重复挂载。 */
  function dispose(): void {
    unsubscribe?.();
    unsubscribe = undefined;
  }

  /** 重置仓库状态，准备进入下一轮安装。 */
  function reset(): void {
    dependencies.value = [];
    phase.value = 'idle';
    currentMessage.value = '';
    currentProgress.value = -1;
    installing.value = false;
    logs.value = [];
    installError.value = null;
  }

  /**
   * 验证 sudo 密码；通过后由主进程在内存中保留。
   *
   * @param password - 用户输入的密码。
   * @returns 验证通过时为 `true`。
   */
  async function verifySudo(password: string): Promise<boolean> {
    return mofoxApi.oobeVerifySudo(password);
  }

  /**
   * 触发依赖安装；安装期间订阅进度事件并更新本地状态。
   *
   * 失败时把错误对象与累积日志保存到 `installError` 与 `logs`，供错误弹窗展示。
   *
   * @returns 安装完成后的全部依赖状态汇总。
   */
  async function installDependencies(): Promise<OobeDependencyStatus[]> {
    subscribe();
    installing.value = true;
    phase.value = 'installing';
    installError.value = null;
    try {
      return await mofoxApi.oobeInstallDependencies();
    } catch (error) {
      // 主进程已将累积日志塞入 MofoxError.details.logs；同步到本地 logs 以保证弹窗可见。
      if (error instanceof MofoxError && error.details?.logs) {
        logs.value = error.details.logs as string[];
      }
      installError.value = error instanceof MofoxError ? error : new MofoxError('INTERNAL', error instanceof Error ? error.message : '未知错误');
      throw error;
    } finally {
      installing.value = false;
    }
  }

  /** 取消正在进行的安装。 */
  async function cancelInstall(): Promise<void> {
    await mofoxApi.oobeCancelInstall();
  }

  /**
   * 完成 OOBE 并标记 `settings.oobeCompleted`。
   *
   * 完成后应同步刷新设置仓库以反映 `oobeCompleted: true`。
   *
   * @returns OOBE 完成摘要，含依赖最终状态与旧启动器探测结果。
   */
  async function complete(): Promise<ReturnType<typeof mofoxApi.oobeComplete>> {
    return mofoxApi.oobeComplete();
  }

  return {
    dependencies,
    phase,
    currentMessage,
    currentProgress,
    installing,
    logs,
    installError,
    subscribe,
    dispose,
    reset,
    verifySudo,
    installDependencies,
    cancelInstall,
    complete,
  };
});
