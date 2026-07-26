import type { SystemEnvInfo } from '../../shared/domain/system-env';
import { detectSystemEnv, pythonExeName } from '../utils/platform-helper';
import { runOneShot, type ExecResult } from '../utils/process-service';

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
      return undefined;
    }
  }
}