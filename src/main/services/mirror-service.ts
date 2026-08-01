import type { MirrorSelection, MirrorSource } from '../../shared/domain/mirror';
import { MofoxError } from '../../shared/domain/error';
import { probeTcpLatency } from '../utils/mirror';

/** 镜像探测服务缓存最近一次成功/失败混合结果，并以可达源中的最低延迟作选择。 */
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
    // 单个探测失败不污染其余结果；无延迟字段明确表示该源本轮不可达。
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
    // 不虚构延迟值，全部失败时向调用方暴露可序列化的领域错误。
    if (available.length === 0) throw new MofoxError('UNAVAILABLE', 'No mirror source is reachable');
    const mirror = available.reduce((best, candidate) =>
      candidate.latencyMs < best.latencyMs ? candidate : best,
    );
    return { mirror, measuredAt: this.measuredAt };
  }
}
