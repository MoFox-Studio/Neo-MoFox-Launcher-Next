<script setup lang="ts">
import type { Instance } from '@shared/domain/instance';
import StatusBadge from '@/components/StatusBadge.vue';

// 信息查看面板：实例名称、运行状态与只读元数据集中展示。
defineProps<{
  instance: Instance;
}>();

const emit = defineEmits<{
  back: [];
}>();

function formatDate(value: number | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<template>
  <section class="manage-group">
    <div class="manage-info__head">
      <button
        class="icon-btn state-layer"
        type="button"
        title="返回"
        aria-label="返回"
        @click="emit('back')"
      >
        <span class="msr" aria-hidden="true">arrow_back</span>
      </button>
      <div class="manage-info__title">
        <h2 class="manage-info__name">{{ instance.name }}</h2>
        <StatusBadge :status="instance.status" />
      </div>
    </div>

    <div class="manage-group__body">
      <dl class="info-grid">
        <div class="info-grid__item">
          <dt>实例 ID</dt>
          <dd class="info-grid__value--mono">{{ instance.id }}</dd>
        </div>
        <div class="info-grid__item">
          <dt>运行状态</dt>
          <dd><StatusBadge :status="instance.status" /></dd>
        </div>
        <div class="info-grid__item">
          <dt>创建时间</dt>
          <dd>{{ formatDate(instance.createdAt) }}</dd>
        </div>
        <div class="info-grid__item">
          <dt>最后启动</dt>
          <dd>{{ formatDate(instance.lastStartedAt) }}</dd>
        </div>
        <div class="info-grid__item">
          <dt>MoFox 安装目录</dt>
          <dd class="info-grid__value--mono">{{ instance.mofoxInstallDir || '—' }}</dd>
        </div>
        <div class="info-grid__item">
          <dt>平台种类</dt>
          <dd>{{ instance.platform?.id ?? '未安装' }}</dd>
        </div>
        <div class="info-grid__item">
          <dt>平台安装目录</dt>
          <dd class="info-grid__value--mono">{{ instance.platform?.installDir || '—' }}</dd>
        </div>
        <div class="info-grid__item">
          <dt>平台版本</dt>
          <dd>{{ instance.platform?.version || '—' }}</dd>
        </div>
        <div class="info-grid__item">
          <dt>启动时自动运行</dt>
          <dd>{{ instance.autoStart ? '是' : '否' }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
.manage-group {
  width: 100%;
  max-width: 824px;
  box-sizing: border-box;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid var(--app-glass-border);
  border-radius: 20px;
  background: var(--app-glass-card);
  box-shadow: var(--app-glass-card-shadow);
  backdrop-filter: var(--app-glass-filter);
  -webkit-backdrop-filter: var(--app-glass-filter);
}

.manage-info__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--app-glass-border);
}

.manage-info__title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.manage-info__name {
  margin: 0;
  font: var(--md-sys-typescale-title-large);
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manage-group__body {
  padding: 24px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin: 0;
}

.info-grid__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-grid__item dt {
  font: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.info-grid__item dd {
  margin: 0;
  font: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface);
}

.info-grid__value--mono {
  font-family: var(--md-ref-typeface-mono);
}

.icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  display: grid;
  place-items: center;
  cursor: pointer;
}
</style>
