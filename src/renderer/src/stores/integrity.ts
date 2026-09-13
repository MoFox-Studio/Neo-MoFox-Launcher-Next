import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { InstanceIntegrityIssue } from '@shared/domain/instance';
import { useInstancesStore } from './instances';

/**
 * 启动完整性检查弹窗仓库：启动时载入缺失项列表，逐项由用户决定删除或保留。
 * 删除复用实例仓库的移除动作（停机 → 删目录 → 删记录），保留则仅丢弃该缺失项。
 */
export const useIntegrityStore = defineStore('integrity', () => {
  const open = ref(false);
  const issues = ref<InstanceIntegrityIssue[]>([]);
  /** 正在处理（删除/保留）中的实例 ID，用于禁用对应操作按钮并展示进度。 */
  const pending = ref<Set<string>>(new Set());
  /** 已处理完成的实例 ID → 是否删除，用于展示确认特效后再由组件调用 `finishResolve` 移出列表。 */
  const resolved = ref<Map<string, boolean>>(new Map());

  function openWith(list: InstanceIntegrityIssue[]): void {
    issues.value = [...list];
    pending.value = new Set();
    resolved.value = new Map();
    open.value = list.length > 0;
  }

  function close(): void {
    open.value = false;
    issues.value = [];
    pending.value = new Set();
    resolved.value = new Map();
  }

  /**
   * 处理单个实例的决策。
   *
   * 操作完成后先标记为已处理（保留在列表中供确认特效展示），
   * 由渲染端在动画结束后调用 {@link finishResolve} 真正移出。
   *
   * @param instanceId - 待处理实例 ID。
   * @param deleteIt - 为 `true` 时删除该实例，为 `false` 时保留记录。
   */
  async function resolve(instanceId: string, deleteIt: boolean): Promise<void> {
    if (pending.value.has(instanceId)) return;
    pending.value = new Set(pending.value).add(instanceId);
    try {
      if (deleteIt) {
        await useInstancesStore().remove(instanceId);
      }
      resolved.value = new Map(resolved.value).set(instanceId, deleteIt);
    } finally {
      const next = new Set(pending.value);
      next.delete(instanceId);
      pending.value = next;
    }
  }

  /**
   * 确认特效结束后把实例移出列表，全部处理完时关闭弹窗。
   *
   * @param instanceId - 已展示确认效果的实例 ID。
   */
  function finishResolve(instanceId: string): void {
    issues.value = issues.value.filter((issue) => issue.instanceId !== instanceId);
    const next = new Map(resolved.value);
    next.delete(instanceId);
    resolved.value = next;
    if (issues.value.length === 0) open.value = false;
  }

  /** 全部保留：清空列表并关闭弹窗。 */
  function keepAll(): void {
    issues.value = [];
    pending.value = new Set();
    resolved.value = new Map();
    open.value = false;
  }

  return { open, issues, pending, resolved, openWith, close, resolve, finishResolve, keepAll };
});
