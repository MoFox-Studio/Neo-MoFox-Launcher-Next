import { describe, expect, it, vi } from 'vitest';
import { MirrorService } from './mirror-service';

describe('MirrorService', () => {
  it('measures every source and selects the lowest successful latency', async () => {
    const probe = vi.fn(async (host: string) => (host.includes('github.com') ? 80 : 20));
    const service = new MirrorService(probe);

    const selection = await service.selectBest();

    expect(selection.mirror.latencyMs).toBe(20);
    expect(probe).toHaveBeenCalled();
    expect((await service.list()).some((mirror) => mirror.latencyMs === 80)).toBe(true);
  });

  it('keeps partial failures available without a fake latency', async () => {
    const service = new MirrorService(async (host) => {
      if (host.includes('github.com')) throw new Error('timeout');
      return 15;
    });

    const mirrors = await service.measure();

    expect(mirrors.find((mirror) => mirror.baseUrl.includes('github.com'))?.latencyMs).toBeUndefined();
    await expect(service.selectBest()).resolves.toMatchObject({ mirror: { latencyMs: 15 } });
  });

  it('fails diagnostically when all probes fail', async () => {
    const service = new MirrorService(async () => {
      throw new Error('offline');
    });

    await expect(service.selectBest()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('uses cached measurements inside the cache interval', async () => {
    const probe = vi.fn(async () => 10);
    const service = new MirrorService(probe, 60_000);

    await service.measure();
    await service.measure();

    expect(probe).toHaveBeenCalledTimes((await service.list()).length);
  });
});