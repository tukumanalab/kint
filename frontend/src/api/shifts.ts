import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';

const BASE = '/api/v1';

export interface SyncStats {
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
}

export interface SyncNowResponse {
  success: boolean;
  message: string;
  stats: SyncStats;
}

export async function syncShiftsNow(token: string): Promise<SyncNowResponse> {
  const res = await fetch(`${BASE}/shifts/sync/now`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({
      code: 'unknown',
      message: res.statusText,
    }));
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<SyncNowResponse>;
}
