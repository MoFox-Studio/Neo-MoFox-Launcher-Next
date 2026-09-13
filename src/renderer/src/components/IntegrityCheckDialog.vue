<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import BaseDialog from '@/components/BaseDialog.vue';
import { useIntegrityStore } from '@/stores/integrity';
import type { InstanceIntegrityProblem } from '@shared/domain/instance';

const integrityStore = useIntegrityStore();

// 缺失项的可读描述与图标，与实例管理写入前的核验语义保持一致。
const PROBLEM_META: Record<InstanceIntegrityProblem, { text: string; icon: string }> = {
  mofox: { text: '主程序缺失', icon: 'folder_off' },
  platform: { text: '平台不可用', icon: 'extension_off' },
};

function isPending(instanceId: string): boolean {
  return integrityStore.pending.has(instanceId);
}

function isResolved(instanceId: string): boolean {
  return integrityStore.resolved.has(instanceId);
}

function resolvedLabel(instanceId: string): string {
  return integrityStore.resolved.get(instanceId) === true ? '已删除' : '已保留';
}

// 剩余待处理数量用于页脚摘要与全部保留按钮的文案。
const remainingCount = computed(() => integrityStore.issues.length);

// 删除是破坏性操作，作为高对比的警示按钮；保留维持现状。
function onDelete(instanceId: string): void {
  void integrityStore.resolve(instanceId, true);
}

function onKeep(instanceId: string): void {
  void integrityStore.resolve(instanceId, false);
}

function onKeepAll(): void {
  integrityStore.keepAll();
}

// 已处理完成的实例短暂展示确认效果后，再优雅移出列表并关闭弹窗。
// 按实例 ID 记录定时器，避免同一实例在多次 resolve 时重复调度。
const resolveTimers = new Map<string, ReturnType<typeof setTimeout>>();

watch(
  () => integrityStore.resolved,
  (resolved) => {
    for (const instanceId of resolved.keys()) {
      if (resolveTimers.has(instanceId)) continue;
      const timer = setTimeout(() => {
        resolveTimers.delete(instanceId);
        integrityStore.finishResolve(instanceId);
      }, 520);
      resolveTimers.set(instanceId, timer);
    }
  },
);

onBeforeUnmount(() => {
  for (const timer of resolveTimers.values()) clearTimeout(timer);
  resolveTimers.clear();
});
</script>

<template>
  <BaseDialog
    :open="integrityStore.open"
    title="实例文件不完整"
    :dismissible="false"
    :width="560"
    :show-actions="false"
  >
    <!-- 头部：警示图标块 + 说明文字 -->
    <div class="integrity-dialog__content">
      <header class="integrity-dialog__head">
        <span class="integrity-dialog__badge" aria-hidden="true">
          <span class="msr integrity-dialog__badge-icon">warning</span>
        </span>
        <div class="integrity-dialog__head-text">
          <h3 class="integrity-dialog__heading">检测到实例文件不完整</h3>
          <p class="integrity-dialog__description">
            以下 {{ remainingCount }} 个实例的安装文件已缺失，可能无法正常启动。请为每个实例选择
            <strong>删除</strong> 或 <strong>保留</strong>。
          </p>
        </div>
      </header>

      <!-- 缺失实例列表：逐条决策，移除带过渡动画 -->
      <TransitionGroup
        v-if="remainingCount > 0"
        name="integrity-item"
        tag="ul"
        class="integrity-dialog__list"
      >
        <li
          v-for="issue in integrityStore.issues"
          :key="issue.instanceId"
          class="integrity-dialog__item"
          :class="{
            'integrity-dialog__item--pending': isPending(issue.instanceId),
            'integrity-dialog__item--resolved': isResolved(issue.instanceId),
          }"
        >
          <div class="integrity-dialog__item-text">
            <span class="integrity-dialog__item-name">{{ issue.name }}</span>
            <template v-if="isResolved(issue.instanceId)">
              <span class="integrity-dialog__resolved-chip">
                <span class="msr integrity-dialog__resolved-chip-icon" aria-hidden="true"
                  >check</span
                >
                {{ resolvedLabel(issue.instanceId) }}
              </span>
            </template>
            <div v-else class="integrity-dialog__chips">
              <span v-for="problem in issue.problems" :key="problem" class="integrity-dialog__chip">
                <span class="msr integrity-dialog__chip-icon" aria-hidden="true">{{
                  PROBLEM_META[problem].icon
                }}</span>
                {{ PROBLEM_META[problem].text }}
              </span>
            </div>
          </div>
          <div v-if="!isResolved(issue.instanceId)" class="integrity-dialog__item-actions">
            <button
              class="btn btn--text state-layer"
              type="button"
              :disabled="isPending(issue.instanceId)"
              @click="onKeep(issue.instanceId)"
            >
              保留
            </button>
            <button
              class="btn btn--danger state-layer"
              type="button"
              :disabled="isPending(issue.instanceId)"
              @click="onDelete(issue.instanceId)"
            >
              <span
                v-if="isPending(issue.instanceId)"
                class="integrity-dialog__spinner"
                aria-hidden="true"
              ></span>
              <span v-else class="msr integrity-dialog__btn-icon" aria-hidden="true">delete</span>
              删除
            </button>
          </div>
          <div v-else class="integrity-dialog__resolved-badge" aria-hidden="true">
            <span class="msr">check</span>
          </div>
        </li>
      </TransitionGroup>

      <!-- 页脚：剩余摘要 + 全部保留 -->
      <footer class="integrity-dialog__footer">
        <span class="integrity-dialog__footer-note"> 还有 {{ remainingCount }} 个实例待处理 </span>
        <button
          class="btn btn--text state-layer"
          type="button"
          :disabled="remainingCount === 0"
          @click="onKeepAll"
        >
          全部保留
        </button>
      </footer>
    </div>
  </BaseDialog>
</template>

<style scoped>
/* 内容区垂直排列，头部、列表与页脚之间保持统一间距 */
.integrity-dialog__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 头部：警示图标块与说明文字的水平排版 */
.integrity-dialog__head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.integrity-dialog__badge {
  display: grid;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 14px;
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  box-shadow: var(--md-sys-elevation-level1);
}

.integrity-dialog__badge-icon {
  font-size: 24px;
}

.integrity-dialog__head-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.integrity-dialog__heading {
  margin: 0;
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-medium);
}

.integrity-dialog__description {
  margin: 0;
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-medium);
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}

.integrity-dialog__description strong {
  color: var(--md-sys-color-error);
  font-weight: 500;
}

/* 实例列表：逐条卡片，带移除过渡 */
.integrity-dialog__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 300px;
  overflow-y: auto;
}

.integrity-dialog__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-high);
  box-shadow: var(--md-sys-elevation-level1);
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    border-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.integrity-dialog__item--pending {
  opacity: 0.6;
  border-style: dashed;
}

/* 处理完成态：从警示色调转为确认色调，展示勾选确认效果 */
.integrity-dialog__item--resolved {
  border-color: var(--md-sys-color-tertiary-container);
  background: color-mix(in srgb, var(--md-sys-color-tertiary-container) 22%, transparent);
}

.integrity-dialog__item-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.integrity-dialog__item-name {
  color: var(--md-sys-color-on-surface);
  font: var(--md-sys-typescale-title-small);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 缺失项标签：错误色调的小胶囊，逐项展示缺失来源 */
.integrity-dialog__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.integrity-dialog__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-error) 12%, transparent);
  color: var(--md-sys-color-error);
  font: var(--md-sys-typescale-label-small);
}

.integrity-dialog__chip-icon {
  font-size: 14px;
}

.integrity-dialog__item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* 已处理确认：左侧状态标签 + 右侧弹出勾选徽章 */
.integrity-dialog__resolved-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  align-self: flex-start;
  padding: 0 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
  font: var(--md-sys-typescale-label-small);
}

.integrity-dialog__resolved-chip-icon {
  font-size: 14px;
}

.integrity-dialog__resolved-badge {
  display: grid;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 50%;
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
  font-size: 18px;
  animation: integrity-pop var(--md-sys-motion-duration-medium2)
    var(--md-sys-motion-easing-emphasized-decelerate);
}

@keyframes integrity-pop {
  from {
    transform: scale(0.4);
    opacity: 0;
  }

  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* 页脚：摘要与全部保留 */
.integrity-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--md-sys-color-outline-variant);
}

.integrity-dialog__footer-note {
  color: var(--md-sys-color-on-surface-variant);
  font: var(--md-sys-typescale-body-small);
}

/* 删除按钮的进度指示 */
.integrity-dialog__spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, currentColor 30%, transparent);
  border-top-color: currentColor;
  animation: integrity-spin 700ms linear infinite;
}

.integrity-dialog__btn-icon {
  font-size: 18px;
}

@keyframes integrity-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 移除过渡：确认效果结束后轻柔淡出并向下收拢 */
.integrity-item-leave-active {
  transition:
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    transform var(--md-sys-motion-duration-medium2)
      var(--md-sys-motion-easing-emphasized-decelerate);
}

.integrity-item-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

.integrity-item-move {
  transition: transform var(--md-sys-motion-duration-medium2) var(--md-sys-motion-easing-standard);
}

/* 与其他视图保持一致的按钮样式 */
.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font: var(--md-sys-typescale-label-large);
  cursor: pointer;
  overflow: hidden;
  transition:
    background-color var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard),
    opacity var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
  pointer-events: none;
}

.btn--danger {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.btn--text {
  background: transparent;
  color: var(--md-sys-color-primary);
  padding: 0 12px;
}

.btn--text:disabled {
  opacity: 0.38;
}

@media (prefers-reduced-motion: reduce) {
  .integrity-dialog__item,
  .integrity-dialog__item-actions,
  .integrity-dialog__resolved-badge,
  .integrity-dialog__footer,
  .integrity-dialog__spinner,
  .integrity-item-leave-active,
  .integrity-item-move {
    transition: none;
    animation: none;
  }

  .integrity-item-leave-to {
    transform: none;
  }
}
</style>
