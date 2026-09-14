import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WallpaperService } from '../../../src/main/services/wallpaper-service';
import {
  DEFAULT_WALLPAPER_DIM,
  DEFAULT_WALLPAPER_OPACITY,
  type LauncherSettings,
} from '../../../src/shared/domain/settings';
import { DEFAULT_SETTINGS } from '../../../src/main/services/settings-service';

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-wallpaper-'));
  tempDirectories.push(directory);
  return directory;
}

function createSettingsStore(initial: LauncherSettings) {
  let settings = { ...initial };

  return {
    get: async () => ({ ...settings }),
    update: async (patch: Partial<LauncherSettings>) => {
      settings = { ...settings, ...patch };
      return { ...settings };
    },
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('WallpaperService', () => {
  it('applies the display defaults when adding the first wallpaper', async () => {
    const directory = await createTempDirectory();
    const source = join(directory, 'source.png');
    await writeFile(source, 'test image');
    const settings = createSettingsStore({
      ...DEFAULT_SETTINGS,
      wallpaperBlur: 7,
      wallpaperOpacity: 0.88,
    });
    const service = new WallpaperService(directory, settings);

    const staged = await service.stage(source);
    const updated = await service.commit(staged.id);

    expect(updated).toMatchObject({
      wallpaperType: 'image',
      wallpaperBlur: 0,
      wallpaperDim: DEFAULT_WALLPAPER_DIM,
      wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
    });
  });

  it('preserves display settings when replacing an existing wallpaper', async () => {
    const directory = await createTempDirectory();
    const source = join(directory, 'source.png');
    await writeFile(source, 'test image');
    const settings = createSettingsStore({
      ...DEFAULT_SETTINGS,
      wallpaperType: 'image',
      wallpaperFileName: 'wallpaper-11111111-1111-1111-1111-111111111111.png',
      wallpaperBlur: 3,
      wallpaperDim: 0.35,
      wallpaperOpacity: 0.35,
    });
    const service = new WallpaperService(directory, settings);

    const staged = await service.stage(source);
    const updated = await service.commit(staged.id);

    expect(updated).toMatchObject({
      wallpaperType: 'image',
      wallpaperBlur: 3,
      wallpaperDim: 0.35,
      wallpaperOpacity: 0.35,
    });
  });

  it('clears wallpaper color source when the active wallpaper is removed', async () => {
    const directory = await createTempDirectory();
    const settings = createSettingsStore({
      ...DEFAULT_SETTINGS,
      themeColorSource: 'wallpaper',
      wallpaperSeedColor: '#123456',
      wallpaperType: 'image',
      wallpaperFileName: 'wallpaper-11111111-1111-1111-1111-111111111111.png',
      wallpaperBlur: 4,
      wallpaperDim: 0.4,
      wallpaperOpacity: 0.3,
    });
    const service = new WallpaperService(directory, settings);

    await expect(service.remove()).resolves.toMatchObject({
      themeColorSource: 'manual',
      wallpaperSeedColor: '',
      wallpaperType: 'none',
      wallpaperFileName: '',
      wallpaperBlur: 0,
      wallpaperDim: DEFAULT_WALLPAPER_DIM,
      wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
    });
  });
});
