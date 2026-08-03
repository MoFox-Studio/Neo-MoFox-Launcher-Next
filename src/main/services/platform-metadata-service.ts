import type { BotPlatformMetadata } from '../../shared/domain/bot-platform';
import type { PlatformRegistry } from '../platforms/registry';

/** 为 IPC 提供可安全复制的平台元数据；注册表尚不可用时保留静态回退列表。 */
const FALLBACK_PLATFORMS: readonly BotPlatformMetadata[] = [
  {
    id: 'napcat',
    name: 'NapCat',
    description: 'NapCatQQ based OneBot 11 integration.',
    supportedPlatforms: ['win32'],
    supportedArch: ['x64'],
    latestVersion: '4.2.19',
  },
  {
    id: 'snowluma',
    name: 'SnowLuma',
    description: 'Lightweight cross-platform bot adapter.',
    supportedPlatforms: ['win32', 'linux', 'darwin'],
    supportedArch: ['x64', 'arm64'],
    latestVersion: '1.3.0',
  },
];

export class PlatformMetadataService {
  /**
   * @param registry - 可选的平台注册表；未提供时使用静态回退列表。
   */
  constructor(private readonly registry?: PlatformRegistry) {}

  /**
   * 列出可安全复制到渲染端的平台元数据。
   *
   * 注册表不可用时回退到 `FALLBACK_PLATFORMS`，确保 IPC 调用方总能拿到非空结果。
   *
   * @returns 平台元数据对象数组的深拷贝。
   */
  list(): BotPlatformMetadata[] {
    const platforms = this.registry?.list() ?? FALLBACK_PLATFORMS;
    return platforms.map((platform) => ({
      id: platform.id,
      name: platform.name,
      description: platform.description,
      latestVersion: platform.latestVersion,
      supportedPlatforms: [...platform.supportedPlatforms],
      supportedArch: [...platform.supportedArch],
    }));
  }
}
