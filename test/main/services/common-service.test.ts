import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectPlatformPath } from '../../../src/main/services/common-service';
import type { BotPlatform } from '../../../src/shared/domain/bot-platform';

/** 覆盖从手动导入迁移到通用服务后的目录校验。 */
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-common-service-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createFakePlatform(id: string, name: string): BotPlatform {
  return {
    id,
    name,
    description: `${name} 平台`,
    supportedPlatforms: ['linux', 'win32'],
    supportedArch: ['x64'],
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
    async getStartCommand(platformPath: string) {
      const entry = join(platformPath, 'index.mjs');
      try {
        await access(entry);
      } catch {
        throw new Error(`missing ${entry}`);
      }
      return { command: 'node', args: [entry], cwd: platformPath };
    },
  };
}

function createPlatformResolver(platforms: BotPlatform[]): {
  get(platformId: string): BotPlatform;
} {
  return {
    get(platformId: string): BotPlatform {
      const platform = platforms.find((candidate) => candidate.id === platformId);
      if (!platform) throw new Error(`unknown platform ${platformId}`);
      return platform;
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('inspectPlatformPath', () => {
  it('reports a valid platform directory against its own start entry', async () => {
    const root = await createTemporaryDirectory();
    const directory = join(root, 'snowluma');
    await mkdir(directory);
    await writeFile(join(directory, 'index.mjs'), 'export {}');
    const platforms = createPlatformResolver([createFakePlatform('snowluma', 'SnowLuma')]);

    await expect(inspectPlatformPath(platforms, 'snowluma', directory)).resolves.toMatchObject({
      absolute: true,
      exists: true,
      isDirectory: true,
      valid: true,
    });
  });

  it('flags a directory without a start entry as invalid', async () => {
    const root = await createTemporaryDirectory();
    const directory = join(root, 'napcat');
    await mkdir(directory);
    const platforms = createPlatformResolver([createFakePlatform('napcat', 'NapCat')]);

    await expect(inspectPlatformPath(platforms, 'napcat', directory)).resolves.toMatchObject({
      exists: true,
      isDirectory: true,
      valid: false,
    });
  });

  it('flags a missing directory as invalid', async () => {
    const root = await createTemporaryDirectory();
    const platforms = createPlatformResolver([createFakePlatform('napcat', 'NapCat')]);

    await expect(
      inspectPlatformPath(platforms, 'napcat', join(root, 'missing')),
    ).resolves.toMatchObject({ exists: false, isDirectory: false, valid: false });
  });
});
