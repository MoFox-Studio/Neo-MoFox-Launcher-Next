import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecResult } from '../../../src/main/utils/process-helper';

const execCommand = vi.fn();

vi.mock('../../../src/main/utils/platform-helper', () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
}));

import {
  checkUpdateStatus,
  checkoutCommit,
  getCommitList,
  getCurrentBranch,
  getCurrentCommit,
  isGitRepository,
  switchBranch,
  updateToLatest,
} from '../../../src/main/utils/git/git';

function result(stdout = '', exitCode = 0): ExecResult {
  return { stdout, stderr: '', exitCode, timedOut: false };
}

const GIT = 'git';

describe('git repository helpers', () => {
  beforeEach(() => {
    execCommand.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('isGitRepository detects a valid git work tree', async () => {
    execCommand.mockResolvedValue(result('true'));
    await expect(isGitRepository('/repo')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith(GIT, ['rev-parse', '--is-inside-work-tree'], {
      cwd: '/repo',
      timeoutMs: 15_000,
    });
  });

  it('isGitRepository returns false when git fails', async () => {
    execCommand.mockResolvedValue(result('', 128));
    await expect(isGitRepository('/nope')).resolves.toBe(false);
  });

  it('getCurrentBranch trims the branch name', async () => {
    execCommand.mockResolvedValue(result('main\n'));
    await expect(getCurrentBranch('/repo')).resolves.toBe('main');
  });

  it('getCurrentBranch returns null for non-repository directories', async () => {
    execCommand.mockResolvedValue(result('', 128));
    await expect(getCurrentBranch('/nope')).resolves.toBe(null);
  });

  it('getCurrentCommit parses hash, message and date', async () => {
    execCommand
      .mockResolvedValueOnce(result('true'))
      .mockResolvedValueOnce(result('a1b2c3d|||fix: 修复问题|||2026-08-20 10:00:00 +0800'));
    await expect(getCurrentCommit('/repo')).resolves.toEqual({
      hash: 'a1b2c3d',
      message: 'fix: 修复问题',
      date: '2026-08-20 10:00:00 +0800',
    });
  });

  it('getCommitList marks the current commit and maps fields', async () => {
    const current = 'a1b2c3d';
    execCommand
      .mockResolvedValueOnce(result('true')) // isGitRepository
      .mockResolvedValueOnce(result('true')) // getCurrentCommit -> isGitRepository
      .mockResolvedValueOnce(
        result(`${current}|||current msg|||2026-08-20 10:00:00 +0800`),
      ) // getCurrentCommit -> log
      .mockResolvedValueOnce(
        result(
          'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0|||current msg|||2026-08-20 10:00:00 +0800\nb2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1|||older msg|||2026-08-19 10:00:00 +0800',
        ),
      );
    const commits = await getCommitList('/repo');
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ hash: current, isCurrent: true, message: 'current msg' });
    expect(commits[1]).toMatchObject({ hash: 'b2c3d4e', isCurrent: false });
  });

  it('checkUpdateStatus reports behind count as hasUpdate', async () => {
    execCommand
      .mockResolvedValueOnce(result('true')) // isGitRepository
      .mockResolvedValueOnce(result('true')) // getCurrentBranch -> isGitRepository
      .mockResolvedValueOnce(result('main')) // getCurrentBranch -> rev-parse
      .mockResolvedValueOnce(result('')) // fetch
      .mockResolvedValueOnce(result('0\t3')); // rev-list
    await expect(checkUpdateStatus('/repo')).resolves.toEqual({
      hasUpdate: true,
      behindCount: 3,
      aheadCount: 0,
    });
  });

  it('checkUpdateStatus tolerates fetch failure and reports zero', async () => {
    execCommand
      .mockResolvedValueOnce(result('true')) // isGitRepository
      .mockResolvedValueOnce(result('true')) // getCurrentBranch -> isGitRepository
      .mockResolvedValueOnce(result('main')) // getCurrentBranch -> rev-parse
      .mockRejectedValueOnce(new Error('offline')) // fetch
      .mockResolvedValueOnce(result('2\t0')); // rev-list
    await expect(checkUpdateStatus('/repo')).resolves.toEqual({
      hasUpdate: false,
      behindCount: 0,
      aheadCount: 2,
    });
  });
});

describe('git mutation helpers', () => {
  beforeEach(() => {
    execCommand.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('switchBranch fetches, stashes if dirty, checks out, pulls and syncs', async () => {
    const progress: string[] = [];
    execCommand
      .mockResolvedValueOnce(result('true')) // isGitRepository
      .mockResolvedValueOnce(result('')) // fetch origin dev
      .mockResolvedValueOnce(result(' M main.py')) // status dirty
      .mockResolvedValueOnce(result('')) // stash
      .mockResolvedValueOnce(result('')) // checkout dev
      .mockResolvedValueOnce(result('')) // pull
      .mockResolvedValueOnce(result('')); // uv sync
    await switchBranch('/repo', 'dev', (message) => progress.push(message));
    const gitCalls = execCommand.mock.calls
      .filter((call) => call[0] === GIT)
      .map((call) => call[1]);
    expect(gitCalls).toEqual([
      ['rev-parse', '--is-inside-work-tree'],
      ['fetch', 'origin', 'dev'],
      ['status', '--porcelain'],
      ['stash'],
      ['checkout', 'dev'],
      ['pull', 'origin', 'dev'],
    ]);
    expect(progress.some((message) => message.includes('暂存本地更改'))).toBe(true);
  });

  it('switchBranch throws for non-repository directories', async () => {
    execCommand.mockResolvedValue(result('', 128));
    await expect(switchBranch('/nope', 'main')).rejects.toThrow('不是有效的 Git 仓库');
  });

  it('checkoutCommit rejects an empty commit hash', async () => {
    execCommand.mockResolvedValue(result('true'));
    await expect(checkoutCommit('/repo', '  ')).rejects.toThrow('提交号不能为空');
  });

  it('updateToLatest pulls the current branch and syncs dependencies', async () => {
    execCommand
      .mockResolvedValueOnce(result('true')) // isGitRepository
      .mockResolvedValueOnce(result('true')) // getCurrentBranch -> isGitRepository
      .mockResolvedValueOnce(result('main')) // getCurrentBranch -> rev-parse
      .mockResolvedValueOnce(result('')) // status clean
      .mockResolvedValueOnce(result('')) // pull
      .mockResolvedValueOnce(result('')); // uv sync
    await updateToLatest('/repo');
    const gitCalls = execCommand.mock.calls
      .filter((call) => call[0] === GIT)
      .map((call) => call[1]);
    expect(gitCalls).toEqual([
      ['rev-parse', '--is-inside-work-tree'],
      ['rev-parse', '--is-inside-work-tree'],
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      ['status', '--porcelain'],
      ['pull', 'origin', 'main'],
    ]);
  });
});
