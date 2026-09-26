/** 实例终端可用的宿主 shell 描述；具体可执行路径由主进程探测。 */
export interface TerminalShellOption {
  /** 稳定的 shell 标识（如 `bash`、`powershell`、`cmd`），打开会话时按此选择。 */
  id: string;
  /** 展示名称（Bash、PowerShell 等）。 */
  label: string;
  /** 探测到的可执行文件绝对路径。 */
  command: string;
  /** 启动参数（如 PowerShell 的 `-NoLogo`）。 */
  args: string[];
  /** 是否为该平台的默认 shell；列表中恰好有一项为 `true`。 */
  isDefault: boolean;
}
