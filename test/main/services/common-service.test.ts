import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectPlatformPath, openExternalUrl, openFile } from '../../../src/main/services/common-service';
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

describe('openFile', () => {
  it('opens the file itself when it exists', async () => {
    const root = await createTemporaryDirectory();
    const file = join(root, 'launcher-settings.json');
    await writeFile(file, '{}');
    const opened: string[] = [];
    const openPath = async (path: string) => {
      opened.push(path);
      return '';
    };

    await expect(openFile(openPath, file, root)).resolves.toBeUndefined();
    expect(opened).toEqual([file]);
  });

  it('falls back to the given directory when the file is missing', async () => {
    const root = await createTemporaryDirectory();
    const opened: string[] = [];
    const openPath = async (path: string) => {
      opened.push(path);
      return '';
    };

    await openFile(openPath, join(root, 'missing.json'), root);
    expect(opened).toEqual([root]);
  });

  it('converts shell failures into an IO_ERROR domain error', async () => {
    const root = await createTemporaryDirectory();

    await expect(
      openFile(async () => 'Failed to open path', join(root, 'missing.json')),
    ).rejects.toMatchObject({ code: 'IO_ERROR', message: 'Failed to open path' });
  });
});

describe('openExternalUrl', () => {
  it('forwards the validated url to the shell adapter', async () => {
    const opened: string[] = [];
    const openExternal = async (url: string) => {
      opened.push(url);
    };

    await expect(
      openExternalUrl(openExternal, 'https://github.com/example/repo'),
    ).resolves.toBeUndefined();
    expect(opened).toEqual(['https://github.com/example/repo']);
  });

  it('converts shell failures into an IO_ERROR domain error', async () => {
    await expect(
      openExternalUrl(async () => {
        throw new Error('No application associated with the URL');
      }, 'https://github.com/example/repo'),
    ).rejects.toMatchObject({
      code: 'IO_ERROR',
      message: 'No application associated with the URL',
    });
  });
});
