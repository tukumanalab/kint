import type { PunchRequest, PunchResponse } from '../types/punch';
import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';

const BASE = '/api/v1';

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
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

export async function postPunch(payload: PunchRequest): Promise<PunchResponse> {
  return request<PunchResponse>('/punches', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
