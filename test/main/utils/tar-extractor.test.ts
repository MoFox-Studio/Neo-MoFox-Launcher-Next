import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as tar from 'tar-stream';
import { afterEach, describe, expect, it } from 'vitest';
import { extractTarGzSecurely } from '../../../src/main/utils/tar-extractor';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function archive(
  entries: Array<{ name: string; type?: tar.Headers['type']; body?: string }>,
) {
  const root = await mkdtemp(join(tmpdir(), 'mofox-tar-'));
  roots.push(root);
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const collected = (async () => {
    for await (const chunk of pack) chunks.push(Buffer.from(chunk));
  })();
  for (const entry of entries)
    pack.entry(
      { name: entry.name, type: entry.type ?? 'file', linkname: '../outside' },
      entry.body ?? '',
    );
  pack.finalize();
  await collected;
  const path = join(root, 'test.tar.gz');
  await writeFile(path, gzipSync(Buffer.concat(chunks)));
  return { path, destination: join(root, 'output') };
}

describe('extractTarGzSecurely', () => {
  it('extracts a normal archive with a root directory and AbortSignal', async () => {
    const { path, destination } = await archive([
      { name: './', type: 'directory' },
      { name: './app/main.py', body: 'hello' },
    ]);
    await extractTarGzSecurely(path, destination, { signal: new AbortController().signal });
    expect(await readFile(join(destination, 'app/main.py'), 'utf8')).toBe('hello');
  });
  it.each(['../outside', '/absolute', 'C:/outside', 'file:stream'])(
    'rejects unsafe path %s',
    async (name) => {
      const { path, destination } = await archive([{ name, body: 'bad' }]);
      await expect(extractTarGzSecurely(path, destination)).rejects.toThrow('不安全');
    },
  );
  it.each(['symlink', 'link', 'fifo'] as const)('rejects %s entries', async (type) => {
    const { path, destination } = await archive([{ name: 'bad', type }]);
    await expect(extractTarGzSecurely(path, destination)).rejects.toThrow('不允许');
  });
  it('enforces file and entry limits', async () => {
    const { path, destination } = await archive([{ name: 'a', body: '12345' }, { name: 'b' }]);
    await expect(extractTarGzSecurely(path, destination, { maxFileBytes: 4 })).rejects.toThrow(
      '单文件',
    );
    await expect(extractTarGzSecurely(path, destination, { maxEntries: 1 })).rejects.toThrow(
      '数量',
    );
  });
});
