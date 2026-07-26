export interface SystemRequirement {
  label: string;
  satisfied: boolean;
  detail?: string;
}

export interface BotPlatformMetadata {
  id: string;
  name: string;
  description: string;
  supportedPlatforms: Array<'win32' | 'linux' | 'darwin'>;
  supportedArch: Array<'x64' | 'arm64'>;
  latestVersion?: string;
}

export interface PlatformAvailability {
  available: boolean;
  reason?: string;
  requirements: SystemRequirement[];
}

export interface StartCommand {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface InstallContext {
  instanceId: string;
  version: string;
  workDir: string;
  targetDir: string;
  mirrorId?: string;
  signal?: AbortSignal;
}

export interface InstallResult {
  version: string;
  installPath: string;
  metadata?: Record<string, string>;
}

export interface PlatformInstaller {
  install(context: InstallContext): Promise<InstallResult>;
}

export interface PlatformConfig {
  configure(instanceId: string, installPath: string): Promise<void>;
}

export interface PlatformUpdater {
  getLatestVersion(): Promise<string>;
  update(context: InstallContext): Promise<InstallResult>;
}

export interface PlatformRuntime {
  getStartCommand(installPath: string, instanceId?: string): Promise<StartCommand>;
}

export interface BotPlatform
  extends BotPlatformMetadata,
    PlatformInstaller,
    PlatformConfig,
    PlatformUpdater,
    PlatformRuntime {
  isAvailable(): Promise<PlatformAvailability>;
}
