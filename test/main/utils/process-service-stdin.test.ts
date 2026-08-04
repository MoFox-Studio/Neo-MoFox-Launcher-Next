import { describe, expect, it } from 'vitest';
import { runOneShot } from '../../../src/main/utils/process-service';

/** 验证 ExecOptions.input 字段：写入后子进程 stdin 能正确读取到密码等输入。 */
describe('runOneShot with stdin input', () => {
  it('writes the input string to child stdin', async () => {
    const result = await runOneShot(
      process.execPath,
      ['-e', "process.stdin.on('data', d => process.stdout.write(d)); process.stdin.on('end', () => process.exit(0))"],
      { input: 'hello-stdin\n', timeoutMs: 5_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello-stdin\n');
  });

  it('does not write to stdin when input is omitted', async () => {
    const result = await runOneShot(process.execPath, ['-e', 'process.exit(0)']);
    expect(result.exitCode).toBe(0);
  });
});
