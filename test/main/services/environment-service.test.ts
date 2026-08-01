import { describe, expect, it, vi } from 'vitest';
import { EnvironmentService } from '../../../src/main/services/environment-service';

describe('EnvironmentService', () => {
  it('adds detected tool versions to system information', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Python 3.12.2', stderr: '', timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'uv 0.6.0', stderr: '', timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'git version 2.47.1', stderr: '', timedOut: false });
    const service = new EnvironmentService(
      async () => ({
        arch: 'x64',
        osType: 'Windows_NT',
        osRelease: '10',
        hostname: 'host',
        homedir: 'home',
        tmpdir: 'tmp',
        shell: 'shell',
      }),
      run,
    );

    await expect(service.detect()).resolves.toMatchObject({
      pythonVersion: '3.12.2',
      uvVersion: '0.6.0',
      gitVersion: '2.47.1',
    });
  });

  it('returns partial results when tools are missing or interrupted', async () => {
    const run = vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'missing', timedOut: false }));
    const service = new EnvironmentService(
      async () => ({
        arch: 'arm64',
        osType: 'Linux',
        osRelease: '6',
        hostname: 'host',
        homedir: 'home',
        tmpdir: 'tmp',
        shell: 'bash',
      }),
      run,
    );

    const result = await service.detect();

    expect(result.pythonVersion).toBeUndefined();
    expect(result.arch).toBe('arm64');
  });
});