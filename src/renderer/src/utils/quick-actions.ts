import type { Router } from 'vue-router';
import type { QuickActionId } from '@shared/domain/home';
import { useAddInstanceStore } from '@/stores/add-instance';
import { useLauncherUpdate } from '@/composables/use-launcher-update';

/** 快捷操作部件的动作定义；执行逻辑统一收口，供主页部件复用。 */
export interface QuickActionDefinition {
  id: QuickActionId;
  label: string;
  icon: string;
}

/** 全部可配置的快捷动作，按展示顺序排列。 */
export const QUICK_ACTION_DEFINITIONS: QuickActionDefinition[] = [
  { id: 'add-instance', label: '新建实例', icon: 'add_circle' },
  { id: 'manage-instances', label: '管理实例', icon: 'apps' },
  { id: 'open-settings', label: '打开设置', icon: 'settings' },
  { id: 'check-update', label: '检查更新', icon: 'system_update_alt' },
];

/** 快捷动作执行所需的运行上下文。 */
export interface QuickActionContext {
  router: Router;
}

/**
 * 执行一个快捷动作。
 *
 * @param id - 动作 ID。
 * @param context - 运行上下文（路由器）。
 */
export function runQuickAction(id: QuickActionId, context: QuickActionContext): void {
  switch (id) {
    case 'add-instance':
      useAddInstanceStore().show();
      break;
    case 'manage-instances':
      void context.router.push({ name: 'instances' });
      break;
    case 'open-settings':
      void context.router.push({ name: 'settings' });
      break;
    case 'check-update':
      void useLauncherUpdate().checkForUpdates();
      break;
  }
}
