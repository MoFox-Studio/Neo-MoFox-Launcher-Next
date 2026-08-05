import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { WallpaperService } from './services/wallpaper-service';

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

/**
 * 为受管壁纸创建支持 CORS 和视频 Range 请求的自定义协议处理器。
 *
 * 处理器只接受 `mofox-wallpaper://local/<受管文件名>`，再由服务层确认该文件
 * 是当前壁纸或尚未提交的暂存副本，避免协议成为任意本地文件读取器。
 *
 * @param service - 负责校验受管媒体并解析安全绝对路径的壁纸服务。
 * @returns 可直接传给 Electron `protocol.handle()` 的 Fetch 风格请求处理器。
 */
export function createWallpaperProtocolHandler(service: WallpaperService) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const fileName = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (url.hostname !== 'local' || !fileName || fileName.includes('/')) {
        return new Response(null, { status: 404 });
      }
      const path = await service.resolveMediaPath(fileName);
      const info = await stat(path);
      const mime = MIME_TYPES[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
      const headers = new Headers({
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      const range = request.headers.get('range');
      if (!range) {
        headers.set('Content-Length', String(info.size));
        return new Response(
          request.method === 'HEAD' ? null : (Readable.toWeb(createReadStream(path)) as ReadableStream),
          { status: 200, headers },
        );
      }

      const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
      if (!match) return new Response(null, { status: 416, headers });
      const start = match[1] === '' ? 0 : Number(match[1]);
      const requestedEnd = match[2] === '' ? info.size - 1 : Number(match[2]);
      const end = Math.min(requestedEnd, info.size - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
        headers.set('Content-Range', `bytes */${info.size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Length', String(end - start + 1));
      headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
      return new Response(
        request.method === 'HEAD'
          ? null
          : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream),
        { status: 206, headers },
      );
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}
