<script setup lang="ts">
import { computed } from 'vue';
import { useInstallDraftStore } from '@/stores/install-draft';

// 确认摘要步骤：以分组卡片汇总展示用户的所有选择，供开始安装前复核。
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
    <div class="step-header">
      <h1>确认摘要</h1>
      <p>请确认以下配置信息，无误后点击「开始安装」。</p>
    </div>

    <div class="summary-content">
      <div class="summary-section">
        <div class="summary-section-header">
          <h3>实例信息</h3>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"><span class="msr" aria-hidden="true">label</span></span>
          <span class="summary-item-label">实例名称</span>
          <span class="summary-item-value">{{ draft.instanceName || '-' }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"
            ><span class="msr" aria-hidden="true">smart_toy</span></span
          >
          <span class="summary-item-label">Bot QQ 号</span>
          <span class="summary-item-value">{{ draft.botQQ || '-' }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"
            ><span class="msr" aria-hidden="true">badge</span></span
          >
          <span class="summary-item-label">Bot 昵称</span>
          <span class="summary-item-value">{{ draft.botNickname || '-' }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"
            ><span class="msr" aria-hidden="true">admin_panel_settings</span></span
          >
          <span class="summary-item-label">主人 QQ</span>
          <span class="summary-item-value">{{ draft.ownerQQ || '-' }}</span>
        </div>
      </div>

      <div class="summary-section">
        <div class="summary-section-header">
          <h3>网络配置</h3>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"
            ><span class="msr" aria-hidden="true">extension</span></span
          >
          <span class="summary-item-label">安装平台</span>
          <span class="summary-item-value">{{ platformName }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"
            ><span class="msr" aria-hidden="true">cloud_sync</span></span
          >
          <span class="summary-item-label">更新通道</span>
          <span class="summary-item-value">{{ branchLabel }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"
            ><span class="msr" aria-hidden="true">settings_ethernet</span></span
          >
          <span class="summary-item-label">WS 端口</span>
          <span class="summary-item-value">{{ draft.wsPort }}</span>
        </div>
      </div>

      <div class="summary-section">
        <div class="summary-section-header">
          <h3>安装选项</h3>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"
            ><span class="msr" aria-hidden="true">dashboard</span></span
          >
          <span class="summary-item-label">安装 WebUI</span>
          <span class="summary-item-value">{{ webuiLabel }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"><span class="msr" aria-hidden="true">key</span></span>
          <span class="summary-item-label">API Key</span>
          <span class="summary-item-value">{{ draft.apiKey ? '••••••••' : '-' }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"><span class="msr" aria-hidden="true">folder</span></span>
          <span class="summary-item-label">安装目录</span>
          <span class="summary-item-value" :title="draft.targetDir">{{
            draft.targetDir || '-'
          }}</span>
        </div>
        <div class="summary-item">
          <span class="summary-item-icon"
            ><span class="msr" aria-hidden="true">create_new_folder</span></span
          >
          <span class="summary-item-label">子文件夹</span>
          <span class="summary-item-value">以实例 ID 命名，自动创建</span>
        </div>
      </div>
    </div>
  </section>
</template>
