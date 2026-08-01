/** 可跨进程传递且供界面分支处理的稳定错误码。 */
export type MofoxErrorCode =
  'INVALID_ARGUMENT' | 'NOT_FOUND' | 'CONFLICT' | 'IO_ERROR' | 'UNAVAILABLE' | 'INTERNAL';

/** IPC 错误的 JSON 载荷；`details` 仅承载可序列化的诊断上下文。 */
export interface MofoxErrorPayload {
  code: MofoxErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** 保留业务错误码和可选上下文的应用错误。 */
export class MofoxError extends Error {
  readonly code: MofoxErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: MofoxErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'MofoxError';
    this.code = code;
    this.details = details;
  }
}

/** 用于在 Electron 传递的 Error.message 中识别结构化错误载荷的前缀。 */
const IPC_ERROR_PREFIX = 'MOFOX_ERROR:';

/**
 * 将任意异常降级为可安全跨 IPC 传输的 Error。
 * 非 Mofox 错误一律映射为 INTERNAL，避免将未验证的错误码暴露给渲染层。
 */
export function serializeIpcError(error: unknown): Error {
  const errorCode = getErrorCode(error);
  const payload: MofoxErrorPayload = {
    code: isMofoxErrorCode(errorCode) ? errorCode : 'INTERNAL',
    message: error instanceof Error ? error.message : 'Unexpected launcher error',
  };
  if (error instanceof MofoxError && error.details) payload.details = error.details;
  return new Error(`${IPC_ERROR_PREFIX}${JSON.stringify(payload)}`);
}

/**
 * 恢复由主进程编码的业务错误；前缀缺失或 JSON 损坏时保留原始错误信息。
 * 兼容非 Error 抛出值，确保调用方始终收到 Error 实例。
 */
export function deserializeIpcError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const prefixIndex = message.indexOf(IPC_ERROR_PREFIX);
  if (prefixIndex < 0) return error instanceof Error ? error : new Error(message);
  try {
    const payload = JSON.parse(
      message.slice(prefixIndex + IPC_ERROR_PREFIX.length),
    ) as MofoxErrorPayload;
    return new MofoxError(payload.code, payload.message, payload.details);
  } catch {
    return error instanceof Error ? error : new Error(message);
  }
}

/** 从未知异常中安全提取候选错误码，避免直接访问空值或原始值。 */
function getErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function isMofoxErrorCode(value: unknown): value is MofoxErrorCode {
  return (
    value === 'INVALID_ARGUMENT' ||
    value === 'NOT_FOUND' ||
    value === 'CONFLICT' ||
    value === 'IO_ERROR' ||
    value === 'UNAVAILABLE' ||
    value === 'INTERNAL'
  );
}
