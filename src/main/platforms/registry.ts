import type { BotPlatform } from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';
import { NapCatPlatform } from './napcat/runtime';
import { SnowLumaPlatform } from './snowluma/runtime';

// 平台实例的进程内注册表，向 IPC 与服务层提供稳定的枚举和按 ID 查找入口。
export class PlatformRegistry {
  private readonly platforms = new Map<string, BotPlatform>();

  /**
   * 构造注册表并填充默认或自定义平台集合。
   *
   * @param platforms - 平台实例数组；缺省时使用内置的 NapCat 与 SnowLuma 平台。
   */
  constructor(platforms: BotPlatform[] = [new NapCatPlatform(), new SnowLumaPlatform()]) {
    // 注入式构造函数允许测试或后续扩展替换默认内置平台集合。
    for (const platform of platforms) this.platforms.set(platform.id, platform);
  }

  /**
   * 列出注册表中所有平台实例。
   *
   * @returns 平台实例数组的浅拷贝。
   */
  list(): BotPlatform[] {
    return [...this.platforms.values()];
  }

  /**
   * 按平台 ID 查找平台实例。
   *
   * @param platformId - 平台唯一标识。
   * @returns 对应的平台实例。
   * @throws {MofoxError} 平台 ID 不存在时抛出 `NOT_FOUND`。
   */
  get(platformId: string): BotPlatform {
    const platform = this.platforms.get(platformId);
    if (!platform) throw new MofoxError('NOT_FOUND', `未知平台: ${platformId}`);
    return platform;
  }
}
