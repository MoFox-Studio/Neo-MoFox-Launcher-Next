import { randomUUID } from 'node:crypto';

/**
 * 实例 ID 生成器：基于 `crypto.randomUUID` 生成全局稳定唯一 ID，避免进程重启后自增计数器归零造成的冲突。
 *
 * 历史实现使用 `install-${nextId++}` 自增格式，重启后 nextId 归零可能与已有实例 ID 冲突；
 * 改用 randomUUID 后前缀仅作可读性标识，唯一性由 UUID 本身保证。
 */

/** 实例 ID 的可读性前缀；与安装任务 ID 共用同一前缀以保持日志与状态可追溯。 */
export const INSTANCE_ID_PREFIX = 'mofox';

/**
 * 生成一个新的实例 ID，格式为 `${INSTANCE_ID_PREFIX}-${uuid}`。
 *
 * @returns 形如 `mofox-3f2504e0-4f89-11d3-9a0c-0305e82c3301` 的全局唯一字符串。
 */
export function generateInstanceId(): string {
  return `${INSTANCE_ID_PREFIX}-${randomUUID()}`;
}
