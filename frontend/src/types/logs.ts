export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  logger: string;
  message: string;
  exc_info?: string;
}

export interface LogsResponse {
  entries: LogEntry[];
  total: number;
}

export interface LogsQuery {
  level?: LogLevel | '';
  keyword?: string;
  limit?: number;
}
