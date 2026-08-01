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
  constructor(private readonly registry?: PlatformRegistry) {}

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
