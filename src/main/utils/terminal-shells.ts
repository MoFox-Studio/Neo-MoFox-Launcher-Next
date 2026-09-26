import { access, constants } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { TerminalShellOption } from '../../shared/domain/terminal-shell';
import { isWindows } from './platform-helper';

/**
 * 探测当前系统可用的交互 shell，供实例终端面板下拉框渲染与会话启动使用。
 *
 * 以静态候选表 + 常见安装位置存在性探测实现，不依赖 PATH 解析
 * （GUI 启动的进程缺少交互 shell 注入的 PATH）；POSIX 上额外纳入
 * 用户默认 shell（`$SHELL`）。结果中恰好有一项标记为默认。
 */

/** 候选 shell 的静态描述；`paths` 按优先级列出常见安装位置。 */
interface ShellCandidate {
  id: string;
  label: string;
  args: string[];
  paths: string[];
}

const POSIX_SHELL_CANDIDATES: ShellCandidate[] = [
  {
    id: 'bash',
    label: 'Bash',
    args: [],
    paths: ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash'],
  },
  {
    id: 'zsh',
    label: 'Zsh',
    args: [],
    paths: ['/bin/zsh', '/usr/bin/zsh', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh'],
  },
  {
    id: 'fish',
    label: 'Fish',
    args: [],
    paths: ['/usr/bin/fish', '/usr/local/bin/fish', '/opt/homebrew/bin/fish'],
  },
  { id: 'sh', label: 'sh', args: [], paths: ['/bin/sh', '/usr/bin/sh'] },
];

/** Windows 系统根目录，用于拼接系统自带 shell 的绝对路径。 */
const windowsRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';

const WINDOWS_SHELL_CANDIDATES: ShellCandidate[] = [
  {
    id: 'powershell',
    label: 'PowerShell',
    args: ['-NoLogo'],
    paths: [join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')],
  },
  {
    id: 'pwsh',
    label: 'PowerShell 7',
    args: ['-NoLogo'],
    paths: [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\6\\pwsh.exe',
    ],
  },
  { id: 'cmd', label: 'CMD', args: [], paths: [join(windowsRoot, 'System32', 'cmd.exe')] },
  {
    id: 'gitbash',
    label: 'Git Bash',
    args: [],
    paths: ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'],
  },
];

/**
 * 探测当前系统可用的交互 shell。
 *
 * @returns 按 `id` 去重后的可用 shell 列表；恰好一项 `isDefault`，
 *   平台探测全部失败时为空列表。
 */
export async function detectTerminalShells(): Promise<TerminalShellOption[]> {
  const base = isWindows() ? WINDOWS_SHELL_CANDIDATES : POSIX_SHELL_CANDIDATES;
  const candidates = await withUserShell(base);
  const resolved = await Promise.all(candidates.map(resolveCandidate));
  const available = resolved.filter((option): option is TerminalShellOption => option !== null);
  // 用户默认 shell 可能与候选表条目同 id 不同路径，按 id 去重保持先到优先。
  const unique = new Map<string, TerminalShellOption>();
  for (const option of available) if (!unique.has(option.id)) unique.set(option.id, option);
  const shells = [...unique.values()];
  if (shells.length === 0) return [];
  const defaultId = pickDefaultId(shells);
  return shells.map((option) => ({ ...option, isDefault: option.id === defaultId }));
}

/**
 * 把用户默认 shell（`$SHELL`）纳入 POSIX 候选表；已覆盖时不重复添加。
 *
 * @param candidates - 平台静态候选表。
 * @returns 补充后的候选表。
 */
async function withUserShell(candidates: ShellCandidate[]): Promise<ShellCandidate[]> {
  const userShell = process.env.SHELL?.trim();
  if (!userShell || isWindows()) return candidates;
  if (candidates.some((candidate) => candidate.paths.includes(userShell))) return candidates;
  const name = basename(userShell);
  return [...candidates, { id: name, label: name, args: [], paths: [userShell] }];
}

/**
 * 依序探测候选路径，返回第一个可执行的 shell 描述。
 *
 * @param candidate - 候选 shell。
 * @returns 可用 shell 描述；所有路径均不可用时为 `null`。
 */
async function resolveCandidate(candidate: ShellCandidate): Promise<TerminalShellOption | null> {
  for (const path of candidate.paths) {
    if (await isExecutable(path)) {
      return {
        id: candidate.id,
        label: candidate.label,
        command: path,
        args: candidate.args,
        isDefault: false,
      };
    }
  }
  return null;
}

/** 判断路径存在且当前用户可执行；Windows 上退化为存在性检查。 */
async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, isWindows() ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 选取默认 shell：Windows 优先 PowerShell，POSIX 优先 `$SHELL`，其次 Bash。
 *
 * @param shells - 已去重的可用 shell 列表（非空）。
 * @returns 默认 shell 的 ID。
 */
function pickDefaultId(shells: readonly TerminalShellOption[]): string {
  const ids = new Set(shells.map((shell) => shell.id));
  if (isWindows()) return ids.has('powershell') ? 'powershell' : shells[0].id;
  const userShell = basename(process.env.SHELL ?? '');
  if (userShell && ids.has(userShell)) return userShell;
  return ids.has('bash') ? 'bash' : shells[0].id;
}
