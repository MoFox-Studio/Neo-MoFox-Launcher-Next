export type { InstallTaskContext, PlatformInstallResult } from './types';
import { installMoFox } from './install-mofox';
import { installPlatform } from './install-platform';
import { installWebUi } from './install-webui';
import { configureInstance } from './configure';

export { installMoFox, installPlatform, installWebUi, configureInstance };
