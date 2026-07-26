import { Socket } from 'node:net';

export function probeTcpLatency(host: string, port = 443, timeoutMs = 3_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const startedAt = performance.now();
    const finish = (error?: Error) => {
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