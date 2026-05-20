import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';
import type { LogsQuery, LogsResponse } from '../types/logs';

const BASE = '/api/v1';

export async function getLogs(token: string, query: LogsQuery = {}): Promise<LogsResponse> {
  const params = new URLSearchParams();
  if (query.level) params.set('level', query.level);
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.limit !== undefined) params.set('limit', String(query.limit));

  const qs = params.toString();
  const url = `${BASE}/logs${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({
      code: 'unknown',
      message: res.statusText,
    }));
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<LogsResponse>;
}
