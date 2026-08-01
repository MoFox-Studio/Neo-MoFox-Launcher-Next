import type { BotPlatform } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import { NapCatPlatform } from './napcat/runtime';
import { SnowLumaPlatform } from './snowluma/runtime';

// 平台实例的进程内注册表，向 IPC 与服务层提供稳定的枚举和按 ID 查找入口。
export class PlatformRegistry {
  private readonly platforms = new Map<string, BotPlatform>();

  constructor(platforms: BotPlatform[] = [new NapCatPlatform(), new SnowLumaPlatform()]) {
    // 注入式构造函数允许测试或后续扩展替换默认内置平台集合。
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
