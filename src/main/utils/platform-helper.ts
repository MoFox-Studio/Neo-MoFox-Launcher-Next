import { access, readFile } from 'node:fs/promises';
import { homedir, hostname, platform, release, tmpdir, type, arch } from 'node:os';
import { delimiter, join } from 'node:path';
import extract from 'extract-zip';
import treeKill from 'tree-kill';
import type { SystemEnvInfo } from '../../shared/domain/system-env';
import { runOneShot, spawnProcess, type ExecOptions, type ExecResult } from './process-service';

export function isWindows(): boolean {
  return platform() === 'win32';
}

export function isLinux(): boolean {
  return platform() === 'linux';
}

export function isMac(): boolean {
  return platform() === 'darwin';
}

export async function detectSystemEnv(): Promise<SystemEnvInfo> {
  const result: SystemEnvInfo = {
    arch: arch(),
    osType: type(),
    osRelease: release(),
    hostname: hostname(),
    homedir: homedir(),
    tmpdir: tmpdir(),
    shell: process.env.SHELL ?? process.env.COMSPEC ?? (isWindows() ? 'cmd.exe' : '/bin/sh'),
  };
  if (isLinux()) {
    try {
      Object.assign(result, parseOsRelease(await readFile('/etc/os-release', 'utf8')));
    } catch {
      // Distribution details are optional.
    }
  }
  return result;
}

export function parseOsRelease(
  source: string,
): Pick<SystemEnvInfo, 'distroFamily' | 'packageManager'> {
  const values = Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, '').toLowerCase()]),
  );
  const identity = `${values.ID ?? ''} ${values.ID_LIKE ?? ''}`;
  if (/debian|ubuntu|mint/.test(identity)) return { distroFamily: 'debian', packageManager: 'apt' };
  if (/arch|manjaro/.test(identity)) return { distroFamily: 'arch', packageManager: 'pacman' };
  if (/fedora|rhel|centos|rocky|alma/.test(identity)) {
    return { distroFamily: 'redhat', packageManager: values.ID === 'centos' ? 'yum' : 'dnf' };
  }
  if (/suse|opensuse/.test(identity)) return { distroFamily: 'suse', packageManager: 'zypper' };
  return {};
}

export function pythonExeName(): string {
  return isWindows() ? 'python.exe' : 'python3';
}

export async function findVenvPython(projectDirectory: string): Promise<string | undefined> {
  const candidate = join(projectDirectory, '.venv', isWindows() ? 'Scripts' : 'bin', pythonExeName());
  try {
    await access(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

export { spawnProcess };

export function execCommand(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return runOneShot(command, args, { ...options, env: buildSpawnEnv(options.env) });
}

export function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  return new Promise((resolve, reject) => {
    treeKill(pid, signal, async (error) => {
      if (!error) {
        resolve();
        return;
      }
      const fallback = nativeKillCommand(pid, signal);
      const result = await runOneShot(fallback.command, fallback.args);
      if (result.exitCode === 0) resolve();
      else reject(error);
    });
  });
}

export async function unzip(zipPath: string, destinationDirectory: string): Promise<void> {
  await extract(zipPath, { dir: destinationDirectory });
}

export function quoteShellArg(value: string): string {
  if (isWindows()) return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function prepareArgsForShell(args: readonly string[], useShell: boolean): string[] {
  return useShell ? args.map(quoteShellArg) : [...args];
}

export function buildSpawnEnv(extraEnvironment: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    ...extraEnvironment,
  };
  if (!isWindows()) {
    const additions = ['.cargo/bin', '.local/bin', 'bin'].map((directory) => join(homedir(), directory));
    environment.PATH = [...additions, environment.PATH ?? ''].filter(Boolean).join(delimiter);
  }
  return environment;
}

export function nativeRemovalCommand(path: string): { command: string; args: string[] } {
  if (isWindows()) {
    const escaped = path.replace(/%/g, '%%').replace(/"/g, '""');
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `if exist "${escaped}\\*" (rmdir /s /q "${escaped}") else del /f /q "${escaped}"`],
    };
  }
  return { command: 'rm', args: ['-rf', '--', path] };
}

function nativeKillCommand(pid: number, signal: NodeJS.Signals): { command: string; args: string[] } {
  if (isWindows()) return { command: 'taskkill.exe', args: ['/PID', String(pid), '/T', '/F'] };
  return { command: 'kill', args: [`-${signal}`, String(pid)] };
}