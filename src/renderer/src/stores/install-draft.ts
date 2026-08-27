import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import type { InstallRequest, InstallTargetCheck } from '@shared/domain/install';
import { mofoxApi } from '@/services/mofox-api';
import {
  validateApiKey,
  validateBotNickname,
  validateInstanceName,
  validateQQNumber,
  validateTargetDir,
  validateWebuiKey,
  validateWsPort,
} from '@/utils/install-validation';

/** 安装目标目录所在盘符允许的最小剩余空间（1 GiB），用于在向导中提前拦截空间不足。 */
const MIN_FREE_SPACE_BYTES = 1024 * 1024 * 1024;

const createEmptyDraft = (): InstallRequest => ({
  instanceName: '',
  platformId: '',
  mofoxBranch: 'main',
  wsPort: 8095,
  botQQ: '',
  botNickname: '',
  ownerQQ: '',
  apiKey: '',
  installWebui: true,
  webuiApiKey: '',
  targetDir: '',
});

/**
 * 安装向导的草稿数据源：集中承载用户输入与逐字段校验，
 * 各步骤组件读写同一份草稿，主向导据此决定可否前进。
 */
export const useInstallDraftStore = defineStore('install-draft', () => {
  const draft = ref<InstallRequest>(createEmptyDraft());
  const touched = reactive<Record<string, boolean>>({});

  const fieldErrors = computed(() => ({
    instanceName: validateInstanceName(draft.value.instanceName),
    botQQ: validateQQNumber(draft.value.botQQ),
    botNickname: validateBotNickname(draft.value.botNickname),
    ownerQQ: validateQQNumber(draft.value.ownerQQ),
    apiKey: validateApiKey(draft.value.apiKey),
    wsPort: validateWsPort(draft.value.wsPort),
    webuiKey: draft.value.installWebui ? validateWebuiKey(draft.value.webuiApiKey) : '',
    targetDir: validateTargetDir(draft.value.targetDir),
  }));

  const allValid = computed(() =>
    Object.values(fieldErrors.value).every((message) => message === ''),
  );

  // 安装目录的跨进程校验结果：由主进程探测盘符空间与写入权限，校验期间锁定前进按钮。
  const targetDirCheck = ref<InstallTargetCheck | null>(null);
  const validatingTargetDir = ref(false);
  const targetDirCheckError = ref('');

  function touch(field: string): void {
    touched[field] = true;
  }

  function isInvalid(field: keyof typeof fieldErrors.value): boolean {
    return Boolean(touched[field]) && fieldErrors.value[field] !== '';
  }

  function set<K extends keyof InstallRequest>(field: K, value: InstallRequest[K]): void {
    draft.value[field] = value;
  }

  /**
   * 委托主进程校验安装目标目录所在盘符的空间与写入权限。
   *
   * 只在本字段基础校验通过后执行，返回 `true` 表示可进入下一步；
   * 校验失败或主进程无法完成校验时写入 `targetDirCheckError` 并返回 `false`。
   *
   * @returns 校验通过时返回 `true`。
   */
  async function validateTargetDirRemote(): Promise<boolean> {
    const value = draft.value.targetDir.trim();
    const formatError = validateTargetDir(value);
    if (formatError) {
      targetDirCheckError.value = formatError;
      targetDirCheck.value = null;
      touched.targetDir = true;
      return false;
    }
    validatingTargetDir.value = true;
    targetDirCheckError.value = '';
    try {
      const check = await mofoxApi.inspectInstallTarget(value);
      targetDirCheck.value = check;
      if (!check.absolute) {
        targetDirCheckError.value = '安装目录必须是绝对路径';
        return false;
      }
      if (!check.exists || !check.isDirectory) {
        targetDirCheckError.value = '安装目录不存在或不是文件夹，请选择已存在的目录';
        return false;
      }
      if (!check.writable) {
        targetDirCheckError.value = '安装目录没有写入权限，无法在此创建文件';
        return false;
      }
      if (check.freeSpaceBytes !== null && check.freeSpaceBytes < MIN_FREE_SPACE_BYTES) {
        targetDirCheckError.value = '所在盘符剩余空间不足（至少需要 1 GiB）';
        return false;
      }
      touched.targetDir = true;
      return true;
    } catch (error) {
      // 校验失败（IPC 异常或无法探测）时如实报错，阻止继续安装。
      targetDirCheckError.value = `无法校验安装目录：${error instanceof Error ? error.message : String(error)}`;
      targetDirCheck.value = null;
      return false;
    } finally {
      validatingTargetDir.value = false;
    }
  }

  function reset(): void {
    draft.value = createEmptyDraft();
    for (const key of Object.keys(touched)) delete touched[key];
    targetDirCheck.value = null;
    validatingTargetDir.value = false;
    targetDirCheckError.value = '';
  }

  return {
    draft,
    fieldErrors,
    allValid,
    targetDirCheck,
    validatingTargetDir,
    targetDirCheckError,
    touch,
    isInvalid,
    set,
    validateTargetDirRemote,
    reset,
  };
});
