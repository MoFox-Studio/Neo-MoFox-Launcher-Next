import { describe, expect, it, vi } from 'vitest';
import { PlatformMetadataService } from '../../../src/main/services/platform-metadata-service';
import type { BotPlatform } from '../../../src/shared/domain/bot-platform';

// 当前宿主平台与架构，用于构造与运行环境匹配的平台元数据。
const CURRENT_PLATFORM = process.platform as 'win32' | 'linux' | 'darwin';
const CURRENT_ARCH = process.arch as 'x64' | 'arm64';

function createFakePlatform(
  id: string,
  supportedPlatforms: Array<'win32' | 'linux' | 'darwin'>,
  supportedArch: Array<'x64' | 'arm64'>,
): BotPlatform {
  return {
    id,
    name: id,
    description: `${id} 平台描述`,
    supportedPlatforms,
    supportedArch,
    async isAvailable() {
      return { available: true, requirements: [] };
    },
    async install() {
      throw new Error('unused');
    },
    async configure() {},
    async getLatestVersion() {
      return '1.0.0';
    },
    async update() {
      throw new Error('unused');
    },
    async getStartCommand() {
      throw new Error('unused');
    },
  };
}

describe('PlatformMetadataService', () => {
  it('仅返回与当前系统匹配的平台，并原样保留平台描述', () => {
    const registry = {
      list: vi.fn(() => [
        createFakePlatform('napcat', [CURRENT_PLATFORM], [CURRENT_ARCH]),
        createFakePlatform('snowluma', [CURRENT_PLATFORM], [CURRENT_ARCH]),
      ]),
    };

    const service = new PlatformMetadataService(registry as never);
    const result = service.list();

    expect(result.map((p) => p.id)).toEqual(
      expect.arrayContaining(['napcat', 'snowluma']),
    );
    expect(result.find((p) => p.id === 'snowluma')?.description).toBe('snowluma 平台描述');
    expect(result.find((p) => p.id === 'napcat')?.description).toBe('napcat 平台描述');
  });

  it('排除了与当前系统不兼容的平台', () => {
    const incompatiblePlatform =
      CURRENT_PLATFORM === 'win32' ? 'linux' : 'win32';
    const registry = {
      list: vi.fn(() => [
        createFakePlatform('napcat', [CURRENT_PLATFORM], [CURRENT_ARCH]),
        createFakePlatform('snowluma', [incompatiblePlatform], [CURRENT_ARCH]),
      ]),
    };

    const service = new PlatformMetadataService(registry as never);
    const result = service.list();

    expect(result.some((p) => p.id === 'napcat')).toBe(true);
    expect(result.some((p) => p.id === 'snowluma')).toBe(false);
  });

  it('无注册表时回退到静态平台列表，并保留推荐描述', () => {
    const service = new PlatformMetadataService();
    const result = service.list();
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((p) => p.description.includes('推荐'))).toBe(true);
  });
});