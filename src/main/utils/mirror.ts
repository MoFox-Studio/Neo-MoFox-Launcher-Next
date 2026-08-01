import { Socket } from 'node:net';

// 以 TCP 建连耗时衡量镜像可达性，不发送 HTTP 请求以避免依赖特定服务端协议。
export function probeTcpLatency(host: string, port = 443, timeoutMs = 3_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const startedAt = performance.now();
    const finish = (error?: Error) => {
      // connect、timeout 与 error 都收敛到同一出口，确保套接字始终关闭。
      socket.destroy();
      if (error) reject(error);
      else resolve(Math.max(1, Math.round(performance.now() - startedAt)));
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish());
    socket.once('timeout', () => finish(new Error(`Connection to ${host} timed out`)));
    socket.once('error', (error) => finish(error));
    socket.connect(port, host);
  });
}
