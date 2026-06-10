import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';

const BASE = '/api/v1';

export interface DeviceTokenResponse {
  device_token: string;
  name: string;
}

export interface DeviceVerifyResponse {
  valid: boolean;
  name: string | null;
}

async function requestWithAuth<T>(path: string, init: RequestInit, token: string): Promise<T> {
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

/**
 * 管理者権限で打刻用端末のデバイストークンを生成する。
 */
export async function postDeviceToken(token: string, name: string): Promise<DeviceTokenResponse> {
  return requestWithAuth<DeviceTokenResponse>(
    '/punch-devices/token',
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
    token,
  );
}

/**
 * デバイストークンの有効性を検証する（認証不要）。
 */
export async function verifyDeviceToken(deviceToken: string): Promise<DeviceVerifyResponse> {
  const res = await fetch(`${BASE}/punch-devices/verify`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Punch-Device-Token': deviceToken,
    },
  });
  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({
      code: 'unknown',
      message: res.statusText,
    }));
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<DeviceVerifyResponse>;
}
