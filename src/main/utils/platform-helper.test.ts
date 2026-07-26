import { describe, expect, it } from 'vitest';
import { buildSpawnEnv, parseOsRelease, prepareArgsForShell, quoteShellArg } from './platform-helper';

describe('platform helper', () => {
  it.each([
    ['ID=ubuntu\nID_LIKE=debian', { distroFamily: 'debian', packageManager: 'apt' }],
    ['ID=manjaro\nID_LIKE=arch', { distroFamily: 'arch', packageManager: 'pacman' }],
    ['ID=fedora\nID_LIKE="rhel fedora"', { distroFamily: 'redhat', packageManager: 'dnf' }],
    ['ID=opensuse-leap', { distroFamily: 'suse', packageManager: 'zypper' }],
  ])('parses Linux family data from os-release', (source, expected) => {
    expect(parseOsRelease(source)).toEqual(expected);
  });

  it('injects UTF-8 Python process settings', () => {
    expect(buildSpawnEnv({ TEST_VALUE: 'yes' })).toMatchObject({
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      TEST_VALUE: 'yes',
    });
  });

  it('quotes shell arguments without losing empty or spaced values', () => {
    expect(quoteShellArg('')).not.toBe('');
    expect(prepareArgsForShell(['plain', 'with space'], false)).toEqual(['plain', 'with space']);
    expect(prepareArgsForShell(['with space'], true)[0]).not.toBe('with space');
  });
});