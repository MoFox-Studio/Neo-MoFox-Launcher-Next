import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstanceRepository } from './instance-repository';

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(process.cwd(), '.test-instances-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('InstanceRepository', () => {
  it('returns an empty list when the repository does not exist', async () => {
    const repository = new InstanceRepository(await createTempDirectory());

    await expect(repository.list()).resolves.toEqual([]);
  });

  it('migrates a legacy versioned repository and resets transient status', async () => {
    const directory = await createTempDirectory();
    await writeFile(
      join(directory, 'instances.json'),
      JSON.stringify({
        version: 4,
        instances: [
          {
            id: 'bot-10001',
            qqNickname: 'Legacy bot',
            neomofoxDir: 'D:\\Bots\\10001',
            platform: 'napcat',
            platformVersion: '4.2.0',
            status: 'running',
            extra: { displayName: 'Primary bot' },
          },
        ],
      }),
    );
    const repository = new InstanceRepository(directory, vi.fn());

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'bot-10001',
        name: 'Primary bot',
        version: '4.2.0',
        platformId: 'napcat',
        installPath: 'D:\\Bots\\10001',
        status: 'stopped',
      }),
    ]);
  });

  it('skips malformed entries and reports diagnostics', async () => {
    const directory = await createTempDirectory();
    await writeFile(join(directory, 'instances.json'), JSON.stringify([{ name: 'Missing id' }]));
    const report = vi.fn();
    const repository = new InstanceRepository(directory, report);

    await expect(repository.list()).resolves.toEqual([]);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('invalid instance'), expect.any(Error));
  });

  it('does not overwrite damaged JSON', async () => {
    const directory = await createTempDirectory();
    const path = join(directory, 'instances.json');
    await writeFile(path, 'not json');
    const repository = new InstanceRepository(directory, vi.fn());

    await expect(repository.list()).resolves.toEqual([]);
    await expect(readFile(path, 'utf8')).resolves.toBe('not json');
  });

  it('upserts and removes canonical records atomically', async () => {
    const directory = await createTempDirectory();
    const repository = new InstanceRepository(directory);
    const instance = {
      id: 'instance-1',
      name: 'Test',
      version: '1.0.0',
      platformId: 'snowluma',
      installPath: 'D:\\Bots\\Test',
      status: 'stopped' as const,
      createdAt: 123,
      autoStart: false,
    };

    await repository.upsert(instance);
    await repository.upsert({ ...instance, name: 'Updated' });
    expect(await repository.list()).toEqual([{ ...instance, name: 'Updated' }]);
    await repository.remove(instance.id);
    expect(await repository.list()).toEqual([]);
  });
});