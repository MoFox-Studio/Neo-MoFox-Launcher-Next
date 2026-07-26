export type MofoxErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IO_ERROR'
  | 'UNAVAILABLE'
  | 'INTERNAL';

export interface MofoxErrorPayload {
  code: MofoxErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

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

const IPC_ERROR_PREFIX = 'MOFOX_ERROR:';

export function serializeIpcError(error: unknown): Error {
  const errorCode = getErrorCode(error);
  const payload: MofoxErrorPayload = {
    code: isMofoxErrorCode(errorCode) ? errorCode : 'INTERNAL',
    message: error instanceof Error ? error.message : 'Unexpected launcher error',
  };
  if (error instanceof MofoxError && error.details) payload.details = error.details;
  return new Error(`${IPC_ERROR_PREFIX}${JSON.stringify(payload)}`);
}

export function deserializeIpcError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const prefixIndex = message.indexOf(IPC_ERROR_PREFIX);
  if (prefixIndex < 0) return error instanceof Error ? error : new Error(message);
  try {
    const payload = JSON.parse(message.slice(prefixIndex + IPC_ERROR_PREFIX.length)) as MofoxErrorPayload;
    return new MofoxError(payload.code, payload.message, payload.details);
  } catch {
    return error instanceof Error ? error : new Error(message);
  }
}

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