import type {
  BotPlatform,
  InstallContext,
  InstallResult,
  PlatformAvailability,
  StartCommand,
} from '../../shared/domain/bot-platform';
import { MofoxError } from '../../shared/domain/error';

export abstract class BaseBotPlatform implements BotPlatform {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly supportedPlatforms: Array<'win32' | 'linux' | 'darwin'>;
  abstract readonly supportedArch: Array<'x64' | 'arm64'>;

  readonly latestVersion: string;

  protected constructor(latestVersion: string) {
    this.latestVersion = latestVersion;
  }

  async isAvailable(): Promise<PlatformAvailability> {
    const platform = process.platform as 'win32' | 'linux' | 'darwin';
    const arch = process.arch === 'x64' || process.arch === 'arm64' ? process.arch : process.arch;
    const available = this.supportedPlatforms.includes(platform) && this.supportedArch.includes(arch as 'x64' | 'arm64');
    return {
      available,
      reason: available ? undefined : `${this.name} 不支持当前系统 ${platform} ${arch}`,
      requirements: [{ label: `${this.name} 运行环境`, satisfied: available, detail: `${platform} ${arch}` }],
    };
  }

  async install(_context: InstallContext): Promise<InstallResult> {
    throw new MofoxError('UNAVAILABLE', `${this.name} 安装器尚未配置下载源`);
  }

  async configure(_instanceId: string, _installPath: string): Promise<void> {
    throw new MofoxError('UNAVAILABLE', `${this.name} 配置器尚未配置`);
  }

  async getLatestVersion(): Promise<string> {
    return this.latestVersion;
  }

  async update(_context: InstallContext): Promise<InstallResult> {
    throw new MofoxError('UNAVAILABLE', `${this.name} 更新器尚未配置下载源`);
  }

  abstract getStartCommand(installPath: string, instanceId?: string): Promise<StartCommand>;
}