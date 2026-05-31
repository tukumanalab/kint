import type {
  AttendanceMonthlySummary,
  AttendanceMonthlyDetailResponse,
} from '../types/attendance';
import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';

const BASE = '/api/v1';

async function request<T>(
  path: string,
  init: RequestInit,
  token: string,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...init,
  });
  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({
      code: 'unknown',
      message: res.statusText,
    }));
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export async function getAttendanceSummary(
  token: string,
  yearMonth: string,
  userId?: string,
): Promise<AttendanceMonthlySummary[]> {
  const params = new URLSearchParams({ year_month: yearMonth });
  if (userId) {
    params.append('user_id', userId);
  }
  return request<AttendanceMonthlySummary[]>(`/attendance/summary?${params.toString()}`, { method: 'GET' }, token);
}

export async function getMonthlyAttendanceDetail(
  token: string,
  yearMonth: string,
  userId: string,
): Promise<AttendanceMonthlyDetailResponse> {
  const params = new URLSearchParams({ year_month: yearMonth, user_id: userId });
  return request<AttendanceMonthlyDetailResponse>(
    `/attendance/monthly?${params.toString()}`,
    { method: 'GET' },
    token,
  );
}

export async function downloadAttendanceCsv(
  token: string,
  yearMonth: string,
  scope: 'detailed' | 'summary',
): Promise<Blob> {
  const params = new URLSearchParams({ year_month: yearMonth, scope });
  const res = await fetch(`${BASE}/attendance/export?${params.toString()}`, {
    method: 'GET',
    headers: {
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

  return res.blob();
}
