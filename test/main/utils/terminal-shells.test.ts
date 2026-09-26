import { describe, expect, it } from 'vitest';
import { detectTerminalShells } from '../../../src/main/utils/terminal-shells';

/** 验证 shell 探测的基本契约：POSIX 上至少一项、默认标记唯一、ID 不重复。 */
describe('detectTerminalShells', () => {
  it('detects at least one interactive shell on POSIX', async () => {
    if (process.platform === 'win32') return; // 候选表与探测路径为 POSIX 语义，仅在 POSIX 断言。
    const shells = await detectTerminalShells();

    expect(shells.length).toBeGreaterThan(0);
    expect(shells.filter((shell) => shell.isDefault)).toHaveLength(1);
  });

  it('returns unique ids with resolvable commands', async () => {
    const shells = await detectTerminalShells();
    const ids = shells.map((shell) => shell.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const shell of shells) {
      expect(shell.command.length).toBeGreaterThan(0);
      expect(Array.isArray(shell.args)).toBe(true);
    }
  });
});
