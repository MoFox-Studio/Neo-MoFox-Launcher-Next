import type { SystemEnvInfo } from '../../shared/domain/system-env';
import { detectSystemEnv, pythonExeName } from './platform-helper';
import { runOneShot, type ExecResult } from './process-service';

/** 并行汇总系统和外部工具版本；任一可选命令失败只省略该字段，不影响环境检测结果。 */
type SystemDetector = () => Promise<SystemEnvInfo>;
type CommandRunner = (command: string, args: readonly string[]) => Promise<ExecResult>;

export class EnvironmentService {
  constructor(
    private readonly detectSystem: SystemDetector = detectSystemEnv,
    private readonly run: CommandRunner = runOneShot,
  ) {}

  /**
   * 并行采集系统信息与外部工具版本。
   *
   * 任一可选命令失败只省略该字段，不影响整体环境检测。
   *
   * @returns 合并系统信息与可用工具版本后的 SystemEnvInfo。
   */
  async detect(): Promise<SystemEnvInfo> {
    const [system, pythonVersion, uvVersion, gitVersion] = await Promise.all([
      this.detectSystem(),
      this.detectVersion(pythonExeName(), ['--version']),
      this.detectVersion('uv', ['--version']),
      this.detectVersion('git', ['--version']),
    ]);
    return {
      ...system,
      ...(pythonVersion ? { pythonVersion } : {}),
      ...(uvVersion ? { uvVersion } : {}),
      ...(gitVersion ? { gitVersion } : {}),
    };
  }

  /**
   * 执行单条命令并解析其版本号。
   *
   * 工具未安装、无法执行或超时均视为预期环境差异，返回 `undefined` 而非抛出。
   *
   * @param command - 待执行的命令名。
   * @param args - 命令参数列表。
   * @returns 命令输出中匹配到的版本号字符串；未匹配或失败时为 `undefined`。
   */
  private async detectVersion(command: string, args: readonly string[]): Promise<string | undefined> {
    try {
      const result = await this.run(command, args);
      if (result.exitCode !== 0 || result.timedOut) return undefined;
      return `${result.stdout}\n${result.stderr}`.match(/\d+\.\d+(?:\.\d+)?/)?.[0];
    } catch {
      // 工具未安装、无法执行或超时均是预期环境差异，不向 IPC 调用方抛出错误。
      return undefined;
    }
  }
}
