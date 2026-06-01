import type {
  AttendanceMonthlySummary,
  AttendanceMonthlyDetailResponse,
  AttendanceCorrectionRequest,
  AttendanceCorrectionRequestListResponse,
  AttendanceLock,
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

export async function createCorrectionRequest(
  token: string,
  body: {
    attendance_id: string;
    requested_check_in: string | null;
    requested_check_out: string | null;
    reason: string;
  },
): Promise<AttendanceCorrectionRequest> {
  return request<AttendanceCorrectionRequest>(
    '/attendance/requests',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  );
}

export async function listCorrectionRequests(
  token: string,
  status?: string,
  userId?: string,
): Promise<AttendanceCorrectionRequestListResponse> {
  const params = new URLSearchParams();
  if (status) {
    params.append('status', status);
  }
  if (userId) {
    params.append('user_id', userId);
  }
  return request<AttendanceCorrectionRequestListResponse>(
    `/attendance/requests?${params.toString()}`,
    { method: 'GET' },
    token,
  );
}

export async function approveCorrectionRequest(
  token: string,
  requestId: string,
  approvalComment?: string,
): Promise<AttendanceCorrectionRequest> {
  return request<AttendanceCorrectionRequest>(
    `/attendance/requests/${requestId}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ approval_comment: approvalComment }),
    },
    token,
  );
}

export async function rejectCorrectionRequest(
  token: string,
  requestId: string,
  approvalComment: string,
): Promise<AttendanceCorrectionRequest> {
  return request<AttendanceCorrectionRequest>(
    `/attendance/requests/${requestId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ approval_comment: approvalComment }),
    },
    token,
  );
}

export async function cancelCorrectionRequest(
  token: string,
  requestId: string,
): Promise<void> {
  return request<void>(
    `/attendance/requests/${requestId}`,
    { method: 'DELETE' },
    token,
  );
}

export async function lockMonth(
  token: string,
  yearMonth: string,
): Promise<AttendanceLock> {
  return request<AttendanceLock>(
    '/attendance/locks',
    {
      method: 'POST',
      body: JSON.stringify({ year_month: yearMonth }),
    },
    token,
  );
}

export async function unlockMonth(
  token: string,
  yearMonth: string,
): Promise<void> {
  return request<void>(
    `/attendance/locks/${yearMonth}`,
    { method: 'DELETE' },
    token,
  );
}

export async function listLocks(token: string): Promise<AttendanceLock[]> {
  return request<AttendanceLock[]>('/attendance/locks', { method: 'GET' }, token);
}
