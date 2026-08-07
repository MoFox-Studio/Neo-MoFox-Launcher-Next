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

  /**
   * @param code - 稳定业务错误码，供界面分支处理。
   * @param message - 人类可读错误描述。
   * @param details - 可选的可序列化诊断上下文。
   */
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
 *
 * @param error - 主进程抛出的任意异常。
 * @returns 携带 `MOFOX_ERROR:` 前缀 JSON 载荷的 Error 实例。
 */
export function serializeIpcError(error: unknown): string {
  const errorCode = getErrorCode(error);
  const payload: MofoxErrorPayload = {
    code: isMofoxErrorCode(errorCode) ? errorCode : 'INTERNAL',
    message: error instanceof Error ? error.message : 'Unexpected launcher error',
  };
  if (error instanceof MofoxError && error.details) {
    // IPC 只能传输结构化可克隆数据；异常 details 可能包含路径对象、Error 或其他运行时值。
    try {
      const clonedDetails = structuredClone(error.details);
      payload.details = clonedDetails;
      JSON.stringify(payload);
    } catch {
      // 保留错误码和消息，丢弃不可克隆的诊断上下文，避免二次 IPC 错误。
    }
  }
  return `${IPC_ERROR_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * 恢复由主进程编码的业务错误；前缀缺失或 JSON 损坏时保留原始错误信息。
 * 兼容非 Error 抛出值，确保调用方始终收到 Error 实例。
 *
 * @param error - 经 IPC 传递回渲染层的错误值。
 * @returns 解析成功时为对应的 `MofoxError`，否则为原始 Error。
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

/**
 * 从未知异常中安全提取候选错误码，避免直接访问空值或原始值。
 *
 * @param error - 待检查的异常值。
 * @returns 存在 `code` 字段时返回其值，否则为 `undefined`。
 */
function getErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/**
 * 判断给定值是否为合法的稳定错误码，用作 `MofoxErrorCode` 的类型守卫。
 *
 * @param value - 待校验的错误码候选值。
 * @returns 属于合法错误码集合时为 `true`。
 */
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
