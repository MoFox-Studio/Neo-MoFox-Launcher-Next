import type { MirrorSource } from '../../../shared/domain/mirror';
import type { InstallRequest } from '../../../shared/domain/install';
import type { BotPlatform } from '../../../shared/domain/bot-platform';

/**
 * 单个安装任务共享的执行上下文。
 *
 * `stageDir` 是当前步骤独享的工作目录快照，步骤完成后由主服务复制给下一步使用；
 * `log` 追加普通日志行，`progress` 报告当前步骤内的 0..1 进度。
 */
export interface InstallTaskContext {
  request: InstallRequest;
  /** 当前步骤的工作目录；所有产物只允许写在该目录下。 */
  stageDir: string;
  /** 全部镜像源，任务内部只消费与自己相关的类型。 */
  mirrors: readonly MirrorSource[];
  signal: AbortSignal;
  /** 所选平台实例；仅当请求选择了平台时为平台实现，否则为 `undefined`。 */
  platform?: BotPlatform;
  log(message: string): void;
  progress(message: string, fraction: number): void;
}

/** 平台安装任务的结果，供主服务在注册实例时回填版本号。 */
export interface PlatformInstallResult {
  version: string;
}
