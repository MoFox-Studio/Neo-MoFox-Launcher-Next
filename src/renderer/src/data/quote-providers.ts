import type { QuoteProviderSetting, QuoteRotationInterval } from '@shared/domain/home';

/** 主页名言部件的展示元数据：来源选项、轮换选项与轮换间隔毫秒数。 */

/** 名言来源选项，供设置界面与部件展示。 */
export interface QuoteProviderOption {
  id: QuoteProviderSetting;
  label: string;
  description: string;
  icon: string;
}

/** 全部名言来源选项。 */
export const QUOTE_PROVIDER_OPTIONS: QuoteProviderOption[] = [
  { id: 'random', label: '随机', description: '在全部来源间随机挑选', icon: 'shuffle' },
  { id: 'hitokoto', label: '一言', description: 'hitokoto.cn 聚合句子，支持分类筛选', icon: 'format_quote' },
  { id: 'jinrishici', label: '今日诗词', description: '每次一句应景的古诗词', icon: 'auto_stories' },
];

/** 轮换间隔选项，供设置界面渲染。 */
export const QUOTE_ROTATION_OPTIONS: Array<{ id: QuoteRotationInterval; label: string }> = [
  { id: 'off', label: '仅手动' },
  { id: '10s', label: '10 秒' },
  { id: '30s', label: '30 秒' },
  { id: '1m', label: '1 分钟' },
  { id: '5m', label: '5 分钟' },
  { id: '15m', label: '15 分钟' },
];

/** 轮换间隔对应的毫秒数。 */
export const QUOTE_ROTATION_MS: Record<Exclude<QuoteRotationInterval, 'off'>, number> = {
  '10s': 10_000,
  '30s': 30_000,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
};
