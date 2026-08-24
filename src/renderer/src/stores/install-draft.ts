import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import type { InstallRequest } from '@shared/domain/install';
import {
  validateApiKey,
  validateInstanceName,
  validateQQNumber,
  validateTargetDir,
  validateWebuiKey,
  validateWsPort,
} from '@/utils/install-validation';

const createEmptyDraft = (): InstallRequest => ({
  instanceName: '',
  platformId: '',
  mofoxBranch: 'main',
  wsPort: 8095,
  botQQ: '',
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
    ownerQQ: validateQQNumber(draft.value.ownerQQ),
    apiKey: validateApiKey(draft.value.apiKey),
    wsPort: validateWsPort(draft.value.wsPort),
    webuiKey: draft.value.installWebui ? validateWebuiKey(draft.value.webuiApiKey) : '',
    targetDir: validateTargetDir(draft.value.targetDir),
  }));

  const allValid = computed(() =>
    Object.values(fieldErrors.value).every((message) => message === ''),
  );

  function touch(field: string): void {
    touched[field] = true;
  }

  function isInvalid(field: keyof typeof fieldErrors.value): boolean {
    return Boolean(touched[field]) && fieldErrors.value[field] !== '';
  }

  function set<K extends keyof InstallRequest>(field: K, value: InstallRequest[K]): void {
    draft.value[field] = value;
  }

  function reset(): void {
    draft.value = createEmptyDraft();
    for (const key of Object.keys(touched)) delete touched[key];
  }

  return { draft, fieldErrors, allValid, touch, isInvalid, set, reset };
});
