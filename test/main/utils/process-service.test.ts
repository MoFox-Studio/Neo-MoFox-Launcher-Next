import { describe, expect, it } from 'vitest';
import { runOneShot } from '../../../src/main/utils/process-service';

describe('runOneShot', () => {
  it('captures stdout, stderr and the exit code separately', async () => {
    const result = await runOneShot(process.execPath, [
      '-e',
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    ]);

    expect(result).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 3, timedOut: false });
  });

  it('reports spawn failures without hanging', async () => {
    const result = await runOneShot('definitely-not-a-real-command-mofox', []);

    expect(result.exitCode).toBeNull();
    expect(result.stderr).not.toBe('');
  });

  it('times out and terminates long-running commands', async () => {
    const result = await runOneShot(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  });
});