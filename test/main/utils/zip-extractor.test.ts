import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractZipSecurely } from '../../../src/main/utils/zip-extractor';

interface ZipFixtureEntry {
  name: string;
  content?: string;
  mode?: number;
}

/** 计算测试 ZIP 的 CRC-32，避免为几个安全夹具再引入压缩包写入依赖。 */
function crc32(value: Buffer): number {
  let checksum = 0xffffffff;
  for (const byte of value) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

/** 构造仅使用 STORE 方法的最小 ZIP，允许精确设置 Unix 文件类型。 */
function createZip(entries: readonly ZipFixtureEntry[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.content ?? '', 'utf8');
    const checksum = crc32(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localRecords.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(((entry.mode ?? 0o100644) * 0x10000) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(centralHeader, name);
    localOffset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

describe('extractZipSecurely', () => {
  const temporaryRoots: string[] = [];

  async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'mofox-zip-test-'));
    temporaryRoots.push(root);
    return root;
  }

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
  });

  it('extracts regular files and creates their parent directories', async () => {
    const root = await temporaryRoot();
    const archive = join(root, 'safe.zip');
    const destination = join(root, 'payload');
    await writeFile(
      archive,
      createZip([
        { name: 'app/', mode: 0o040755 },
        { name: 'app/config/settings.json', content: '{"safe":true}' },
      ]),
    );

    await extractZipSecurely(archive, destination);

    await expect(readFile(join(destination, 'app/config/settings.json'), 'utf8')).resolves.toBe(
      '{"safe":true}',
    );
  });

  it('rejects entries that traverse outside the destination', async () => {
    const root = await temporaryRoot();
    const archive = join(root, 'traversal.zip');
    const destination = join(root, 'payload');
    const escaped = join(root, 'escaped.txt');
    await writeFile(archive, createZip([{ name: '../escaped.txt', content: 'escaped' }]));

    await expect(extractZipSecurely(archive, destination)).rejects.toThrow();
    await expect(access(escaped)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects symbolic-link entries before later files can write through them', async () => {
    const root = await temporaryRoot();
    const archive = join(root, 'symlink.zip');
    const destination = join(root, 'payload');
    const escaped = join(root, 'escaped.txt');
    await writeFile(
      archive,
      createZip([
        { name: 'linked', content: '..', mode: 0o120777 },
        { name: 'linked/escaped.txt', content: 'escaped' },
      ]),
    );

    await expect(extractZipSecurely(archive, destination)).rejects.toThrow('符号链接');
    await expect(access(escaped)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects NTFS alternate-data-stream paths', async () => {
    const root = await temporaryRoot();
    const archive = join(root, 'ads.zip');
    await writeFile(archive, createZip([{ name: 'safe.txt:payload', content: 'escaped' }]));

    await expect(extractZipSecurely(archive, join(root, 'payload'))).rejects.toThrow('NTFS 数据流');
  });
});
