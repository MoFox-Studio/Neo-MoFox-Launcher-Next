import type { SystemEnvInfo } from '../../shared/domain/system-env';
import { detectSystemEnv, pythonExeName } from '../utils/platform-helper';
import { runOneShot, type ExecResult } from '../utils/process-service';

/** 并行汇总系统和外部工具版本；任一可选命令失败只省略该字段，不影响环境检测结果。 */
type SystemDetector = () => Promise<SystemEnvInfo>;
type CommandRunner = (command: string, args: readonly string[]) => Promise<ExecResult>;

export class EnvironmentService {
  constructor(
    private readonly detectSystem: SystemDetector = detectSystemEnv,
    private readonly run: CommandRunner = runOneShot,
  ) {}

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
