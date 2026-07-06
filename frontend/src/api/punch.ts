import type {
  PunchRequest,
  PunchResponse,
  PunchUserCandidateListResponse,
} from '../types/punch';
import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';

const BASE = '/api/v1';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
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

export async function postPunch(payload: PunchRequest, deviceToken?: string | null): Promise<PunchResponse> {
  const headers: Record<string, string> = {};
  if (deviceToken) {
    headers['X-Punch-Device-Token'] = deviceToken;
  }
  return request<PunchResponse>('/punches', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

export async function searchPunchUsers(query: string): Promise<PunchUserCandidateListResponse> {
  const params = new URLSearchParams({ q: query });
  return request<PunchUserCandidateListResponse>(`/punches/users?${params.toString()}`, {
    method: 'GET',
  });
}
