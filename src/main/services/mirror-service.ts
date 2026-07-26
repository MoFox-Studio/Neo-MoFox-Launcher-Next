import type { MirrorSelection, MirrorSource } from '../../shared/domain/mirror';
import { MofoxError } from '../../shared/domain/error';
import { probeTcpLatency } from '../utils/mirror';

type Probe = (host: string, port?: number, timeoutMs?: number) => Promise<number>;

const MIRRORS: readonly MirrorSource[] = [
  { id: 'gh-direct', type: 'github', name: 'GitHub', baseUrl: 'https://github.com' },
  { id: 'gh-proxy', type: 'github', name: 'GitHub Proxy', baseUrl: 'https://ghproxy.net' },
  { id: 'py-tuna', type: 'python-ftp', name: 'TUNA Python', baseUrl: 'https://pypi.tuna.tsinghua.edu.cn' },
  { id: 'py-huawei', type: 'python-ftp', name: 'Huawei Python', baseUrl: 'https://repo.huaweicloud.com' },
];

export class MirrorService {
  private measured?: MirrorSource[];
  private measuredAt = 0;

  constructor(
    private readonly probe: Probe = probeTcpLatency,
    private readonly cacheDurationMs = 5 * 60_000,
  ) {}

  async list(): Promise<MirrorSource[]> {
    return (this.measured ?? MIRRORS).map((mirror) => ({ ...mirror }));
  }

  async measure(): Promise<MirrorSource[]> {
    if (this.measured && Date.now() - this.measuredAt < this.cacheDurationMs) return this.list();
    this.measured = await Promise.all(
      MIRRORS.map(async (mirror) => {
        try {
          const host = new URL(mirror.baseUrl).hostname;
          return { ...mirror, latencyMs: await this.probe(host, 443, 3_000) };
        } catch {
          return { ...mirror };
        }
      }),
    );
    this.measuredAt = Date.now();
    return this.list();
  }

  async selectBest(): Promise<MirrorSelection> {
    const mirrors = await this.measure();
    const available = mirrors.filter(
      (mirror): mirror is MirrorSource & { latencyMs: number } => mirror.latencyMs !== undefined,
    );
    if (available.length === 0) throw new MofoxError('UNAVAILABLE', 'No mirror source is reachable');
    const mirror = available.reduce((best, candidate) =>
      candidate.latencyMs < best.latencyMs ? candidate : best,
    );
    return { mirror, measuredAt: this.measuredAt };
  }
}