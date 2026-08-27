import { access, readFile } from 'node:fs/promises';
import { homedir, hostname, platform, release, tmpdir, type, arch } from 'node:os';
import { delimiter, join } from 'node:path';
import extract from 'extract-zip';
import type { SystemEnvInfo } from '../../shared/domain/system-env';
import { runOneShot, spawnProcess, type ExecOptions, type ExecResult } from './process-helper';

// 归集跨平台的系统识别、命令行构造及归档/进程边界操作，供主进程服务复用。

/**
 * 判断当前进程是否运行在 Windows 上。
 *
 * @returns 平台为 `win32` 时返回 `true`。
 */
export function isWindows(): boolean {
  return platform() === 'win32';
}

/**
 * 判断当前进程是否运行在 Linux 上。
 *
 * @returns 平台为 `linux` 时返回 `true`。
 */
export function isLinux(): boolean {
  return platform() === 'linux';
}

/**
 * 判断当前进程是否运行在 macOS 上。
 *
 * @returns 平台为 `darwin` 时返回 `true`。
 */
export function isMac(): boolean {
  return platform() === 'darwin';
}

/**
 * 采集当前系统的硬件、操作系统与 Shell 等环境信息。
 *
 * Linux 上额外尝试解析 `/etc/os-release` 以补充发行版与包管理器字段。
 *
 * @returns 包含架构、OS、主机名、家目录、临时目录与 Shell 的 SystemEnvInfo。
 */
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

/**
 * 解析 `/etc/os-release` 内容，推断发行版谱系与包管理器。
 *
 * ID 与 ID_LIKE 均可标识发行版谱系，优先映射为可执行的包管理器。
 *
 * @param source - `/etc/os-release` 文件内容。
 * @returns 包含 `distroFamily` 与 `packageManager` 的对象；无法识别时为空对象。
 */
export function parseOsRelease(
  source: string,
): Pick<SystemEnvInfo, 'distroFamily' | 'packageManager'> {
  // /etc/os-release 的 ID 与 ID_LIKE 均可标识发行版谱系，优先映射为可执行的包管理器。
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

/**
 * 返回当前平台的 Python 可执行文件名。
 *
 * @returns Windows 上为 `python.exe`，其他平台为 `python3`。
 */
export function pythonExeName(): string {
  return isWindows() ? 'python.exe' : 'python3';
}

/**
 * 在项目目录下查找虚拟环境的 Python 可执行文件。
 *
 * @param projectDirectory - 项目根目录。
 * @returns venv Python 路径；不存在时为 `undefined`。
 */
export async function findVenvPython(projectDirectory: string): Promise<string | undefined> {
  const candidate = join(
    projectDirectory,
    '.venv',
    isWindows() ? 'Scripts' : 'bin',
    pythonExeName(),
  );
  try {
    await access(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

export { spawnProcess };

/**
 * 执行一次性命令，自动注入主进程的标准化环境变量。
 *
 * @param command - 待执行的命令名。
 * @param args - 命令参数列表。
 * @param options - 透传给 `runOneShot` 的执行选项。
 * @returns 包含 stdout/stderr/exitCode 等字段的执行结果。
 */
export function execCommand(
  command: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return runOneShot(command, args, { ...options, env: buildSpawnEnv(options.env) });
}

/**
 * 解压 ZIP 文件到目标目录。
 *
 * @param zipPath - ZIP 文件路径。
 * @param destinationDirectory - 解压目标目录。
 */
export async function unzip(zipPath: string, destinationDirectory: string): Promise<void> {
  await extract(zipPath, { dir: destinationDirectory });
}

/**
 * 按当前平台规则对单个 shell 参数进行转义。
 *
 * Windows cmd 与 POSIX shell 的转义规则不同，必须在交由 shell 解析前分支处理。
 *
 * @param value - 待转义的原始参数。
 * @returns 平台相关的已转义字符串。
 */
export function quoteShellArg(value: string): string {
  // Windows cmd 与 POSIX shell 的转义规则不同，必须在交由 shell 解析前分支处理。
  if (isWindows()) return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * 根据是否使用 shell 决定是否对参数列表进行转义。
 *
 * @param args - 原始参数列表。
 * @param useShell - 是否将通过 shell 执行。
 * @returns 处理后的参数数组。
 */
export function prepareArgsForShell(args: readonly string[], useShell: boolean): string[] {
  return useShell ? args.map(quoteShellArg) : [...args];
}

/**
 * 构造子进程环境变量，覆盖 Python 编码与缓冲设置，并在非 Windows 上补齐用户级 PATH。
 *
 * @param extraEnvironment - 额外注入的环境变量。
 * @returns 合并后的环境变量对象。
 */
export function buildSpawnEnv(extraEnvironment: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    ...extraEnvironment,
  };
  if (!isWindows()) {
    // GUI 启动的进程常缺少交互 shell 注入的 PATH，补齐常见用户级可执行目录。
    const additions = ['.cargo/bin', '.local/bin', 'bin'].map((directory) =>
      join(homedir(), directory),
    );
    environment.PATH = [...additions, environment.PATH ?? ''].filter(Boolean).join(delimiter);
  }
  return environment;
}

/**
 * 构造平台原生的递归删除命令。
 *
 * 将路径作为参数传给原生命令，并针对 cmd 的变量与引号解析规则做转义。
 *
 * @param path - 待删除的路径。
 * @returns 包含 `command` 与 `args` 的命令描述对象。
 */
export function nativeRemovalCommand(path: string): { command: string; args: string[] } {
  // 将路径作为参数传给原生命令，并针对 cmd 的变量与引号解析规则做转义。
  if (isWindows()) {
    const escaped = path.replace(/%/g, '%%').replace(/"/g, '""');
    return {
      command: 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        `if exist "${escaped}\\*" (rmdir /s /q "${escaped}") else del /f /q "${escaped}"`,
      ],
    };
  }
  return { command: 'rm', args: ['-rf', '--', path] };
}
