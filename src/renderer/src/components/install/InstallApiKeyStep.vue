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
    <div class="step-header">
      <h1>模型配置</h1>
      <p>填写大语言模型 API 密钥，让机器人能够思考与对话。</p>
    </div>

    <form class="config-form" @submit.prevent>
      <div class="form-group">
        <div class="api-key-row">
          <label class="field field--grow" :class="{ 'field--error': store.isInvalid('apiKey') }">
            <input
              id="input-api-key"
              v-model="draft.apiKey"
              class="field__input"
              :type="keyType"
              placeholder=" "
              autocomplete="off"
              spellcheck="false"
              @input="store.touch('apiKey')"
            />
            <span class="field__label">API Key *</span>
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
            @click="jumpToGetKey"
          >
            <span class="msr" aria-hidden="true">key</span>
            获取密钥
          </button>
        </div>
        <p v-if="store.isInvalid('apiKey')" class="field__support field__support--error">
          {{ store.fieldErrors.apiKey }}
        </p>
        <p v-else class="field__support">大模型 API 密钥，默认使用硅基流动，通常以 sk- 开头</p>
      </div>
    </form>
  </section>
</template>
