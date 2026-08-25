import type { BotPlatformMetadata } from '../../shared/domain/bot-platform';
import type { PlatformRegistry } from '../platforms/registry';

// 为 IPC 提供可安全复制的平台元数据；注册表尚不可用时保留静态回退列表。
const FALLBACK_PLATFORMS: readonly BotPlatformMetadata[] = [
  {
    id: 'napcat',
    name: 'NapCat',
    description: 'NapCatQQ 的 OneBot 11 接入，仅支持 Windows，不推荐使用。',
    supportedPlatforms: ['win32'],
    supportedArch: ['x64'],
    latestVersion: '4.2.19',
  },
  {
    id: 'snowluma',
    name: 'SnowLuma',
    description: '轻量跨平台适配器，支持 Windows / Linux，推荐使用。',
    supportedPlatforms: ['win32', 'linux'],
    supportedArch: ['x64', 'arm64'],
    latestVersion: '1.9.2',
  },
];

export class PlatformMetadataService {
  /**
   * @param registry - 可选的平台注册表；未提供时使用静态回退列表。
   */
  constructor(private readonly registry?: PlatformRegistry) {}

  /**
   * 列出当前系统可用并可安全复制到渲染端的平台元数据。
   *
   * 只返回与当前宿主操作系统及架构匹配的平台；推荐偏好已写入各平台的描述文本，
   * 渲染端据描述与平台排序决定默认选择（SnowLuma 优先）。
   *
   * 注册表不可用时回退到 `FALLBACK_PLATFORMS`，确保 IPC 调用方总能拿到非空结果。
   *
   * @returns 平台元数据对象数组的深拷贝。
   */
  list(): BotPlatformMetadata[] {
    const platforms = this.registry?.list() ?? FALLBACK_PLATFORMS;
    const currentPlatform = process.platform as 'win32' | 'linux' | 'darwin';
    const currentArch = process.arch as 'x64' | 'arm64';

    const usable = platforms.filter(
      (platform) =>
        platform.supportedPlatforms.includes(currentPlatform) &&
        platform.supportedArch.includes(currentArch),
    );

    return usable.map((platform) => ({
      id: platform.id,
      name: platform.name,
      description: platform.description,
      latestVersion: platform.latestVersion,
      supportedPlatforms: [...platform.supportedPlatforms],
      supportedArch: [...platform.supportedArch],
    }));
  }
}
