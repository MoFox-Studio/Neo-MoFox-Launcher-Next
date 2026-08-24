<script setup lang="ts">
import { computed } from 'vue';
import { useInstallDraftStore } from '@/stores/install-draft';

// 确认摘要步骤：汇总展示用户的所有选择，供开始安装前复核。
const store = useInstallDraftStore();
const draft = store.draft;

const platformName = computed(() => {
  if (!draft.platformId) return '不安装平台';
  if (draft.platformId === 'napcat') return 'NapCat';
  if (draft.platformId === 'snowluma') return 'SnowLuma';
  return draft.platformId;
});

const branchLabel = computed(() =>
  draft.mofoxBranch === 'dev' ? '开发版 (dev)' : '稳定版 (main)',
);
const webuiLabel = computed(() => (draft.installWebui ? '是' : '否'));
</script>

<template>
  <section class="step">
    <h2 class="step__title">确认摘要</h2>
    <p class="step__desc">请确认以下配置信息，无误后开始安装。</p>

    <dl class="summary">
      <div class="summary__row">
        <dt>实例名称</dt>
        <dd>{{ draft.instanceName || '-' }}</dd>
      </div>
      <div class="summary__row">
        <dt>Bot QQ 号</dt>
        <dd>{{ draft.botQQ || '-' }}</dd>
      </div>
      <div class="summary__row">
        <dt>主人 QQ 号</dt>
        <dd>{{ draft.ownerQQ || '-' }}</dd>
      </div>
      <div class="summary__row">
        <dt>平台</dt>
        <dd>{{ platformName }}</dd>
      </div>
      <div class="summary__row">
        <dt>MoFox 分支</dt>
        <dd>{{ branchLabel }}</dd>
      </div>
      <div class="summary__row">
        <dt>WebSocket 端口</dt>
        <dd>{{ draft.wsPort }}</dd>
      </div>
      <div class="summary__row">
        <dt>安装 WebUI</dt>
        <dd>{{ webuiLabel }}</dd>
      </div>
      <div class="summary__row">
        <dt>API Key</dt>
        <dd>{{ draft.apiKey ? '••••••••' : '-' }}</dd>
      </div>
      <div class="summary__row">
        <dt>安装目录</dt>
        <dd>{{ draft.targetDir || '-' }}</dd>
      </div>
    </dl>
  </section>
</template>
