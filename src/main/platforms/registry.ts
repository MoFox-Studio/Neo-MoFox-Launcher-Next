import type { BotPlatform } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import { NapCatPlatform } from './napcat/runtime';
import { SnowLumaPlatform } from './snowluma/runtime';

export class PlatformRegistry {
  private readonly platforms = new Map<string, BotPlatform>();

  constructor(platforms: BotPlatform[] = [new NapCatPlatform(), new SnowLumaPlatform()]) {
    for (const platform of platforms) this.platforms.set(platform.id, platform);
  }

  list(): BotPlatform[] {
    return [...this.platforms.values()];
  }

  get(platformId: string): BotPlatform {
    const platform = this.platforms.get(platformId);
    if (!platform) throw new MofoxError('NOT_FOUND', `未知平台: ${platformId}`);
    return platform;
  }
}