export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type RotationMode = 'daily' | 'size';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  scope: string;
  message: string;
}
