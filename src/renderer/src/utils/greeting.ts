/** 按小时返回问候语；供主页 Hero 与时钟部件共用，保证文案一致。 */

/**
 * 根据当前小时计算问候语。
 *
 * @param hour - 24 小时制的小时数（0-23）。
 * @returns 对应时段的问候文案。
 */
export function greetingByHour(hour: number): string {
  if (hour < 6) return '夜深了，注意休息';
  if (hour < 12) return '早上好，开始新的一天';
  if (hour < 18) return '下午好，来看看实例状态';
  return '晚上好，看看今天的实例情况';
}
