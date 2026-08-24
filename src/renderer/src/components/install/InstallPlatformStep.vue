<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { mofoxApi } from '@/services/mofox-api';
import type { BotPlatformMetadata } from '@shared/domain/bot-platform';
import type { MofoxBranch } from '@shared/domain/install';
import { useInstallDraftStore } from '@/stores/install-draft';

// 网络配置步骤：选择平台适配器、MoFox 跟踪分支与 OneBot WebSocket 端口。
const store = useInstallDraftStore();
const draft = store.draft;

const PLATFORM_LABELS: Record<string, string> = {
  win32: 'Windows',
  linux: 'Linux',
  darwin: 'macOS',
};

const platforms = ref<BotPlatformMetadata[]>([]);
const loading = ref(false);

function platformLabel(sys: string): string {
  return PLATFORM_LABELS[sys] ?? sys;
}

function selectPlatform(id: string): void {
  store.set('platformId', id);
  store.touch('platformId');
}

function onPortInput(event: Event): void {
  const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
  store.set('wsPort', Number.isNaN(value) ? 0 : value);
  store.touch('wsPort');
}

onMounted(async () => {
  loading.value = true;
  try {
    platforms.value = await mofoxApi.listBotPlatforms();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="step">
    <h2 class="step__title">网络配置</h2>
    <p class="step__desc">选择平台适配器、MoFox 更新通道以及机器人监听的 WebSocket 端口。</p>

    <div v-if="loading" class="step__loading">
      <span class="spinner" aria-hidden="true"></span>
      <span>加载平台列表…</span>
    </div>
    <div v-else class="platform-grid">
      <button
        v-for="p in platforms"
        :key="p.id"
        type="button"
        class="platform-card state-layer"
        :class="{ 'platform-card--selected': draft.platformId === p.id }"
        @click="selectPlatform(p.id)"
      >
        <span
          v-if="draft.platformId === p.id"
          class="msr msr--fill platform-card__check"
          aria-hidden="true"
          >check_circle</span
        >
        <h3 class="platform-card__name">{{ p.name }}</h3>
        <p class="platform-card__desc">{{ p.description }}</p>
        <div class="platform-card__chips">
          <span v-for="sys in p.supportedPlatforms" :key="sys" class="chip">{{
            platformLabel(sys)
          }}</span>
        </div>
      </button>
      <button
        type="button"
        class="platform-card state-layer"
        :class="{ 'platform-card--selected': draft.platformId === '' }"
        @click="selectPlatform('')"
      >
        <span
          v-if="draft.platformId === ''"
          class="msr msr--fill platform-card__check"
          aria-hidden="true"
          >check_circle</span
        >
        <h3 class="platform-card__name">不安装平台</h3>
        <p class="platform-card__desc">仅安装 Neo-MoFox 本体与已选组件，不连接 QQ。</p>
      </button>
    </div>

    <div class="field__row">
      <div>
        <label class="field">
          <select v-model="draft.mofoxBranch" class="field__select">
            <option :value="'main' as MofoxBranch">稳定版 (main)</option>
            <option :value="'dev' as MofoxBranch">开发版 (dev)</option>
          </select>
          <span class="field__label field__label--select">MoFox 分支</span>
        </label>
        <p class="field__support">选择跟踪的 GitHub 分支</p>
      </div>

      <div>
        <label class="field" :class="{ 'field--error': store.isInvalid('wsPort') }">
          <input
            class="field__input"
            type="number"
            :value="draft.wsPort"
            min="1024"
            max="65535"
            @input="onPortInput"
          />
          <span class="field__label">WebSocket 端口</span>
        </label>
        <p v-if="store.isInvalid('wsPort')" class="field__support field__support--error">
          {{ store.fieldErrors.wsPort }}
        </p>
        <p v-else class="field__support">平台 WS 客户端将连接到此端口</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.field__select {
  width: 100%;
  height: 100%;
  padding: 20px 16px 6px;
  border-radius: var(--md-sys-shape-corner-small);
  border: 1px solid var(--md-sys-color-outline);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-body-large);
  outline: none;
  appearance: none;
}

.field__select:focus {
  border: 2px solid var(--md-sys-color-primary);
  padding: 19px 15px 5px;
}

.field__label--select {
  pointer-events: none;
}
</style>
