<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useInstallDraftStore } from '@/stores/install-draft';
import { evaluateKeyStrength, generateSecureKey } from '@/utils/install-validation';

// 组件选择步骤：决定是否安装 WebUI，并在安装时设置其 HTTP 路由访问密钥。
const store = useInstallDraftStore();
const draft = store.draft;

const showKey = ref(false);
const justGenerated = ref(false);
const keyType = computed(() => (showKey.value ? 'text' : 'password'));
const keyIcon = computed(() => (showKey.value ? 'visibility_off' : 'visibility'));
const strength = computed(() => evaluateKeyStrength(draft.webuiApiKey));

function toggleWebui(checked: boolean): void {
  store.set('installWebui', checked);
  store.touch('installWebui');
}

function generate(): void {
  const key = generateSecureKey(32);
  store.set('webuiApiKey', key);
  store.touch('webuiApiKey');
  justGenerated.value = true;
  void navigator.clipboard?.writeText(key).catch(() => undefined);
}

// 生成后短暂展示明文，方便用户确认并保存。
watch(justGenerated, (value) => {
  if (!value) return;
  showKey.value = true;
  setTimeout(() => {
    justGenerated.value = false;
    showKey.value = false;
  }, 2000);
});
</script>

<template>
  <section class="step">
    <div class="step-header">
      <h1>组件选择</h1>
      <p>选择是否安装 WebUI 可视化控制台，并设置它的访问密钥。</p>
    </div>

    <form class="config-form" @submit.prevent>
      <div class="form-group">
        <label class="checkbox-group">
          <input
            type="checkbox"
            :checked="draft.installWebui"
            @change="toggleWebui(($event.target as HTMLInputElement).checked)"
          />
          <span class="checkbox-label">安装 WebUI（Web 管理控制台）</span>
        </label>
        <span class="form-hint">可视化配置与管理界面，支持一键更新，推荐安装</span>
      </div>

      <template v-if="draft.installWebui">
        <div class="form-section-divider">
          <span class="msr" aria-hidden="true">security</span>
          <span>插件 HTTP 路由 访问控制</span>
        </div>

        <div class="form-group">
          <div class="api-key-row">
            <label class="field" :class="{ 'field--error': store.isInvalid('webuiKey') }">
              <input
                id="input-webui-api-key"
                v-model="draft.webuiApiKey"
                class="field__input"
                :type="keyType"
                placeholder=" "
                autocomplete="off"
                spellcheck="false"
                @input="store.touch('webuiApiKey')"
              />
              <span class="field__label">WebUI / HTTP 路由访问密钥 *</span>
              <button
                type="button"
                class="btn-toggle-password"
                :title="showKey ? '隐藏' : '显示'"
                @click="showKey = !showKey"
              >
                <span class="msr" aria-hidden="true">{{ keyIcon }}</span>
              </button>
            </label>
            <button
              type="button"
              class="btn btn--tonal btn-get-api-key state-layer"
              @click="generate"
            >
              <span class="msr" aria-hidden="true">casino</span>
              随机生成
            </button>
          </div>
          <p v-if="store.isInvalid('webuiKey')" class="field__support field__support--error">
            {{ store.fieldErrors.webuiKey }}
          </p>
          <p v-else class="field__support">
            至少 8 位字符，用于访问 WebUI 控制台与插件 HTTP 路由认证
          </p>

          <div class="password-strength">
            <div class="strength-bar">
              <div class="strength-fill" :class="strength.level"></div>
            </div>
            <span class="strength-text" :class="strength.level">{{ strength.text }}</span>
          </div>
        </div>

        <div class="info-box">
          <span class="msr" aria-hidden="true">info</span>
          <div>
            <strong>安全提示</strong>
            <p>
              此密钥用于访问 WebUI 管理界面和插件 HTTP
              路由认证，请妥善保管，不要分享给他人。安装完成后可在配置文件中修改。
            </p>
          </div>
        </div>
      </template>
    </form>
  </section>
</template>
