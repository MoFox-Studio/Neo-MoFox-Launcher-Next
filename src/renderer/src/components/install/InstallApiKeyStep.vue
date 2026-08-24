<script setup lang="ts">
import { computed, ref } from 'vue';
import { mofoxApi } from '@/services/mofox-api';
import { useInstallDraftStore } from '@/stores/install-draft';

// 模型配置步骤：输入大语言模型 API 密钥，并提供一键跳转获取密钥的快捷按钮。
const store = useInstallDraftStore();
const draft = store.draft;

const showKey = ref(false);

const keyType = computed(() => (showKey.value ? 'text' : 'password'));
const keyIcon = computed(() => (showKey.value ? 'visibility_off' : 'visibility'));

async function jumpToGetKey(): Promise<void> {
  await mofoxApi.openExternal('https://cloud.siliconflow.cn/i/0ww8zcOn');
}
</script>

<template>
  <section class="step">
    <h2 class="step__title">模型配置</h2>
    <p class="step__desc">填写大语言模型 API 密钥，让机器人能够思考与对话。</p>

    <label class="field" :class="{ 'field--error': store.isInvalid('apiKey') }">
      <input
        v-model="draft.apiKey"
        class="field__input"
        :type="keyType"
        placeholder=" "
        autocomplete="off"
        spellcheck="false"
        @input="store.touch('apiKey')"
      />
      <span class="field__label">API Key</span>
      <button
        type="button"
        class="field__reveal state-layer"
        :title="showKey ? '隐藏' : '显示'"
        @click="showKey = !showKey"
      >
        <span class="msr" aria-hidden="true">{{ keyIcon }}</span>
      </button>
    </label>
    <p v-if="store.isInvalid('apiKey')" class="field__support field__support--error">
      {{ store.fieldErrors.apiKey }}
    </p>
    <p v-else class="field__support">默认使用硅基流动（SiliconFlow），密钥通常以 sk- 开头</p>

    <div class="api-key-actions">
      <button type="button" class="btn btn--tonal state-layer" @click="jumpToGetKey">
        <span class="msr" aria-hidden="true">key</span>
        获取 API Key
      </button>
      <span class="api-key-hint">点击按钮将在浏览器中打开注册页面</span>
    </div>
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

.api-key-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.api-key-hint {
  font: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}
</style>
