import type { WorkingHoursReportResponse } from '../types/working_hours_report';
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
  return res.json() as Promise<T>;
}

export async function fetchWorkingHoursReport(
  token: string,
  yearMonth: string,
  userId?: string,
): Promise<WorkingHoursReportResponse> {
  const params = new URLSearchParams({ year_month: yearMonth });
  if (userId) {
    params.set('user_id', userId);
  }
  return request<WorkingHoursReportResponse>(
    `/attendance/working-hours-report?${params.toString()}`,
    { method: 'GET' },
    token,
  );
}
