import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SettingsService } from './settings-service';

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-settings-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('SettingsService', () => {
  it('returns safe defaults when no settings file exists', async () => {
    const service = new SettingsService(await createTempDirectory());

    await expect(service.get()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('migrates legacy settings fields and nested logging values', async () => {
    const directory = await createTempDirectory();
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify({
        theme: 'dark',
        accentColor: '#123456',
        defaultInstallDir: 'D:\\Bots',
        logging: { maxFileSize: 5 * 1024 * 1024, maxArchiveDays: 30, compressArchive: false },
      }),
    );
    const service = new SettingsService(directory);

    await expect(service.get()).resolves.toMatchObject({
      themeMode: 'dark',
      seedColor: '#123456',
      defaultInstallDir: 'D:\\Bots',
      maxLogFileSizeMb: 5,
      maxLogArchiveDays: 30,
      compressLogArchive: false,
    });
  });

  it('falls back without overwriting a damaged file and reports it', async () => {
    const directory = await createTempDirectory();
    const path = join(directory, 'launcher-settings.json');
    await writeFile(path, '{broken');
    const report = vi.fn();
    const service = new SettingsService(directory, report);

    await expect(service.get()).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(readFile(path, 'utf8')).resolves.toBe('{broken');
    expect(report).toHaveBeenCalledWith(expect.stringContaining('launcher-settings.json'), expect.any(Error));
  });

  it('validates updates and atomically persists canonical settings', async () => {
    const directory = await createTempDirectory();
    const service = new SettingsService(directory);

    await expect(service.update({ themeMode: 'dark', maxLogFileSizeMb: 32 })).resolves.toMatchObject({
      themeMode: 'dark',
      maxLogFileSizeMb: 32,
    });
    const persisted = JSON.parse(await readFile(join(directory, 'launcher-settings.json'), 'utf8'));
    expect(persisted).toMatchObject({ themeMode: 'dark', maxLogFileSizeMb: 32 });
    expect(Object.keys(persisted)).toEqual(Object.keys(DEFAULT_SETTINGS));
  });

  it.each([
    [{ themeMode: 'purple' }],
    [{ seedColor: 'red' }],
    [{ maxLogFileSizeMb: 0 }],
    [{ unknown: true }],
  ])('rejects an invalid patch: %j', async (patch) => {
    const service = new SettingsService(await createTempDirectory());

    await expect(service.update(patch)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});