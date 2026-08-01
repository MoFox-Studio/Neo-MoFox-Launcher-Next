import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadRange } from './range-downloader';

const directories: string[] = [];
const servers: Server[] = [];

// 每个用例启动独立本地服务并创建临时目录，结束后统一释放网络和文件系统资源。
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('downloadRange', () => {
  // 覆盖分段并发、服务端不支持 Range 时的降级，以及参数在创建目标文件前的校验。
  it('downloads concurrent ranges and reports throttled progress', async () => {
    const content = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
    const url = await serve(content, true);
    const directory = await mkdtemp(join(process.cwd(), '.test-download-'));
    directories.push(directory);
    const destination = join(directory, 'file.bin');
    const progress = vi.fn();

    await downloadRange(url, destination, { concurrency: 3, minChunkBytes: 4 }, progress);

    await expect(readFile(destination)).resolves.toEqual(content);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ receivedBytes: content.length }));
  });

  it('falls back to a single stream when ranges are unsupported', async () => {
    const content = Buffer.from('single stream response');
    const url = await serve(content, false);
    const directory = await mkdtemp(join(process.cwd(), '.test-download-'));
    directories.push(directory);
    const destination = join(directory, 'file.bin');

    await downloadRange(url, destination, { concurrency: 8, minChunkBytes: 1 });

    await expect(readFile(destination)).resolves.toEqual(content);
  });

  it('rejects invalid options before creating a destination', async () => {
    await expect(downloadRange('https://example.invalid', 'file', { concurrency: 0 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});

async function serve(content: Buffer, ranges: boolean): Promise<string> {
  // 用可切换 Range 能力的本地 HTTP 服务模拟下载端点，避免依赖外部网络。
  const server = createServer((request, response) => {
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        'content-length': content.length,
        ...(ranges ? { 'accept-ranges': 'bytes' } : {}),
      });
      response.end();
      return;
    }
    const range = request.headers.range?.match(/bytes=(\d+)-(\d+)/);
    if (ranges && range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      response.writeHead(206, {
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${content.length}`,
      });
      response.end(content.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { 'content-length': content.length });
    response.end(content);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server has no TCP address');
  return `http://127.0.0.1:${address.port}/file`;
}
