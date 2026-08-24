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
    <h2 class="step__title">组件选择</h2>
    <p class="step__desc">选择是否安装 WebUI 可视化控制台，并设置它的访问密钥。</p>

    <label class="checkbox-row" :class="{ 'checkbox-row--checked': draft.installWebui }">
      <input
        type="checkbox"
        :checked="draft.installWebui"
        @change="toggleWebui(($event.target as HTMLInputElement).checked)"
      />
      <span>
        <span class="checkbox-row__title">安装 WebUI（Web 管理控制台）</span>
        <span class="checkbox-row__desc">浏览器可视化配置与管理界面，强烈建议安装</span>
      </span>
    </label>

    <template v-if="draft.installWebui">
      <label class="field" :class="{ 'field--error': store.isInvalid('webuiKey') }">
        <input
          v-model="draft.webuiApiKey"
          class="field__input"
          :type="keyType"
          placeholder=" "
          autocomplete="off"
          spellcheck="false"
          @input="store.touch('webuiApiKey')"
        />
        <span class="field__label">WebUI 访问密钥</span>
        <button
          type="button"
          class="field__reveal state-layer"
          :title="showKey ? '隐藏' : '显示'"
          @click="showKey = !showKey"
        >
          <span class="msr" aria-hidden="true">{{ keyIcon }}</span>
        </button>
      </label>
      <p v-if="store.isInvalid('webuiKey')" class="field__support field__support--error">
        {{ store.fieldErrors.webuiKey }}
      </p>

      <div class="password-strength">
        <div class="strength-bar">
          <div
            class="strength-fill"
            :class="strength.level"
            :style="{ width: strength.level === 'none' ? '0%' : undefined }"
          ></div>
        </div>
        <span class="strength-text" :class="strength.level">{{ strength.text }}</span>
      </div>

      <button type="button" class="btn btn--tonal state-layer" @click="generate">
        <span class="msr" aria-hidden="true">casino</span>
        随机生成
      </button>
      <p class="field__support">密钥用于保护 WebUI 与插件 HTTP 路由认证，请妥善保管。</p>

      <div class="info-banner">
        <span class="msr info-banner__icon" aria-hidden="true">info</span>
        <span
          >安装完成后可通过 <code>config/core.toml</code> 的
          <code>[http_router]</code> 修改密钥。</span
        >
      </div>
    </template>
  </section>
</template>

<style scoped>
.field__reveal {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}

.field__reveal .msr {
  font-size: 20px;
}

.field__input {
  padding-right: 48px;
}

code {
  font-family: var(--md-ref-typeface-mono);
  font-size: 0.8em;
  background: var(--md-sys-color-surface-container-highest);
  padding: 1px 4px;
  border-radius: 4px;
}

.checkbox-row {
  margin-bottom: 20px;
}
</style>
