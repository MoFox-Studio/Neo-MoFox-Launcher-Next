import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SettingsService } from '../../../src/main/services/settings-service';

/** 覆盖设置生命周期：空存储初始化、旧格式迁移、损坏文件降级及原子更新校验。 */
const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-settings-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('SettingsService', () => {
  it('recovers the last good backup and allows further updates', async () => {
    const directory = await createTempDirectory();
    const first = new SettingsService(directory, vi.fn());
    await first.update({ themeMode: 'dark' });
    await first.update({ themeMode: 'light' });
    await writeFile(join(directory, 'launcher-settings.json'), '{broken');
    const recovered = new SettingsService(directory, vi.fn());
    expect((await recovered.get()).themeMode).toBe('dark');
    await expect(recovered.update({ themeMode: 'system' })).resolves.toMatchObject({
      themeMode: 'system',
    });
  });
  it('returns safe defaults when no settings file exists', async () => {
    const service = new SettingsService(await createTempDirectory());

    await expect(service.get()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('exposes the canonical settings file path', async () => {
    const directory = await createTempDirectory();
    const service = new SettingsService(directory);

    expect(service.filePath).toBe(join(directory, 'launcher-settings.json'));
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
    await expect(service.update({ themeMode: 'dark' })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(readFile(path, 'utf8')).resolves.toBe('{broken');
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining('launcher-settings.json'),
      expect.any(Error),
    );
  });

  it('validates updates and atomically persists canonical settings', async () => {
    const directory = await createTempDirectory();
    const service = new SettingsService(directory);

    await expect(
      service.update({ themeMode: 'dark', maxLogFileSizeMb: 32 }),
    ).resolves.toMatchObject({
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
    [{ paletteStyle: 'pastel' }],
    [{ themeContrast: 'extreme' }],
    [{ navigationPosition: 'top' }],
    [{ wallpaperDim: 0.9 }],
    [{ maxLogFileSizeMb: 0 }],
    [{ unknown: true }],
  ])('rejects an invalid patch: %j', async (patch) => {
    const service = new SettingsService(await createTempDirectory());

    await expect(service.update(patch)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('fills in the default home layout when the field is missing from storage', async () => {
    const directory = await createTempDirectory();
    // 模拟旧版设置文件：不含 home 字段。
    await writeFile(
      join(directory, 'launcher-settings.json'),
      JSON.stringify({ themeMode: 'dark' }),
      'utf8',
    );
    const service = new SettingsService(directory);
    await expect(service.get()).resolves.toMatchObject({
      themeMode: 'dark',
      home: DEFAULT_SETTINGS.home,
    });
  });

  it('normalizes a stored home layout: unknown widgets dropped, missing appended', async () => {
    const directory = await createTempDirectory();
    await writeFile(
      join(directory, 'launcher-settings.json'),
      JSON.stringify({
        home: {
          version: 1,
          widgets: [
            { id: 'totally-unknown', enabled: true, config: {} },
            { id: 'quotes', enabled: true, config: { provider: 'jinrishici', rotation: '5m' } },
            { id: 'clock', enabled: false, config: { hour24: false } },
            { id: 'clock', enabled: true, config: {} },
          ],
        },
      }),
      'utf8',
    );
    const service = new SettingsService(directory);
    const settings = await service.get();
    const ids = settings.home.widgets.map((widget) => widget.id);
    // 未知部件被丢弃、重复 ID 去重、缺失部件按默认顺序补齐。
    expect(ids).toEqual([
      'quotes',
      'clock',
      'metrics',
      'favorites',
      'quickActions',
      'changelog',
      'docs',
    ]);
    // 非法/缺失的配置字段回退默认值。
    expect(settings.home.widgets[0]).toMatchObject({
      id: 'quotes',
      enabled: true,
      config: { provider: 'jinrishici', rotation: '5m', showAuthor: true, showSource: true },
    });
    expect(settings.home.widgets[1]).toMatchObject({
      id: 'clock',
      enabled: false,
      config: { hour24: false, showDate: true, showGreeting: true },
    });
  });

  it('keeps custom docs entries and metric selections through patch validation', async () => {
    const directory = await createTempDirectory();
    const service = new SettingsService(directory);
    const updated = await service.update({
      home: {
        version: 1,
        widgets: [
          {
            id: 'docs',
            enabled: true,
            config: {
              documents: [
                { id: 'a', kind: 'local', name: '指南.md', path: 'C:\\Docs\\指南.md' },
                { id: 'b', kind: 'remote', name: '手册', url: 'https://example.com/manual.md' },
              ],
            },
          },
          {
            id: 'metrics',
            enabled: true,
            config: { items: ['error', 'error', 'running'] },
          },
        ],
      },
    });
    const docs = updated.home.widgets.find((widget) => widget.id === 'docs');
    expect(docs).toMatchObject({
      enabled: true,
      config: {
        documents: [
          { id: 'a', kind: 'local', name: '指南.md', path: 'C:\\Docs\\指南.md' },
          { id: 'b', kind: 'remote', name: '手册', url: 'https://example.com/manual.md' },
        ],
      },
    });
    const metrics = updated.home.widgets.find((widget) => widget.id === 'metrics');
    expect(metrics).toMatchObject({ config: { items: ['error', 'running'] } });
    // 其余部件按默认值补齐在尾部。
    expect(updated.home.widgets.map((widget) => widget.id).slice(-1)).toEqual(['changelog']);
  });

  it('sanitizes invalid docs entries and metric ids when loading from storage', async () => {
    const directory = await createTempDirectory();
    await writeFile(
      join(directory, 'launcher-settings.json'),
      JSON.stringify({
        home: {
          version: 1,
          widgets: [
            {
              id: 'docs',
              enabled: true,
              config: {
                documents: [
                  { id: 'a', kind: 'local', name: '指南.md', path: 'C:\\Docs\\指南.md' },
                  { id: 'c', kind: 'remote', name: '坏链接', url: 'http://example.com/x.md' },
                  { id: 'd', kind: 'local', name: '缺路径', path: '' },
                ],
              },
            },
            {
              id: 'metrics',
              enabled: true,
              config: { items: ['error', 'error', 'nope', 'running'] },
            },
          ],
        },
      }),
      'utf8',
    );
    const service = new SettingsService(directory);
    const settings = await service.get();
    const docs = settings.home.widgets.find((widget) => widget.id === 'docs');
    expect(docs).toMatchObject({
      enabled: true,
      config: {
        documents: [{ id: 'a', kind: 'local', name: '指南.md', path: 'C:\\Docs\\指南.md' }],
      },
    });
    const metrics = settings.home.widgets.find((widget) => widget.id === 'metrics');
    expect(metrics).toMatchObject({ config: { items: ['error', 'running'] } });
  });

  it('rejects home patches that do not satisfy the strict shape', async () => {
    const service = new SettingsService(await createTempDirectory());
    await expect(
      service.update({ home: { version: 1, widgets: 'nope' } as unknown as never }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      service.update({
        home: {
          version: 1,
          widgets: [{ id: 'clock', enabled: true, config: { hour24: 'yes' } }],
        } as unknown as never,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
