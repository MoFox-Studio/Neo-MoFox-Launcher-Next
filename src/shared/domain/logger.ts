/** 启动器及其实例进程共用的日志严重级别。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志归档触发策略。 */
export type RotationMode = 'daily' | 'size';

/** 可通过 IPC 传递并按时间排序的单条日志记录。 */
export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  scope: string;
  message: string;
}
