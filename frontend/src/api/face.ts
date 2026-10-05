import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';
import type {
  FaceStatus,
  FaceDescriptorPutRequest,
  FacePunchConfig,
  FaceIdentifyRequest,
  FaceIdentifyResponse,
  FaceVerifyResult,
} from '../types/face';

const BASE = '/api/v1';

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
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

// ===== 自分自身の顔データ (マイページ) =====

export async function getMyFace(token: string): Promise<FaceStatus> {
  return request<FaceStatus>('/me/face', { method: 'GET' }, token);
}

export async function putMyFace(
  token: string,
  payload: FaceDescriptorPutRequest,
): Promise<FaceStatus> {
  return request<FaceStatus>(
    '/me/face',
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export async function deleteMyFace(token: string): Promise<void> {
  return request<void>('/me/face', { method: 'DELETE' }, token);
}

/** 本人の顔データで顔認証テストを行う */
export async function verifyMyFace(token: string, descriptor: number[]): Promise<FaceVerifyResult> {
  return request<FaceVerifyResult>(
    '/me/face/verify',
    { method: 'POST', body: JSON.stringify({ descriptor }) },
    token,
  );
}

// ===== 管理者による代理登録 (ユーザー管理) =====

export async function getUserFace(token: string, userId: string): Promise<FaceStatus> {
  return request<FaceStatus>(`/users/${encodeURIComponent(userId)}/face`, { method: 'GET' }, token);
}

export async function putUserFace(
  token: string,
  userId: string,
  payload: FaceDescriptorPutRequest,
): Promise<FaceStatus> {
  return request<FaceStatus>(
    `/users/${encodeURIComponent(userId)}/face`,
    { method: 'PUT', body: JSON.stringify(payload) },
    token,
  );
}

export async function deleteUserFace(token: string, userId: string): Promise<void> {
  return request<void>(`/users/${encodeURIComponent(userId)}/face`, { method: 'DELETE' }, token);
}

/** 対象ユーザーの顔データで顔認証テストを行う (管理者専用) */
export async function verifyUserFace(
  token: string,
  userId: string,
  descriptor: number[],
): Promise<FaceVerifyResult> {
  return request<FaceVerifyResult>(
    `/users/${encodeURIComponent(userId)}/face/verify`,
    { method: 'POST', body: JSON.stringify({ descriptor }) },
    token,
  );
}

// ===== 顔認証打刻 (未ログイン端末) =====

export async function getFacePunchConfig(deviceToken?: string | null): Promise<FacePunchConfig> {
  const headers: Record<string, string> = {};
  if (deviceToken) {
    headers['X-Punch-Device-Token'] = deviceToken;
  }
  return request<FacePunchConfig>('/face-punch/config', { method: 'GET', headers });
}

export async function identifyFace(
  payload: FaceIdentifyRequest,
  deviceToken?: string | null,
): Promise<FaceIdentifyResponse> {
  const headers: Record<string, string> = {};
  if (deviceToken) {
    headers['X-Punch-Device-Token'] = deviceToken;
  }
  return request<FaceIdentifyResponse>('/face-punch/identify', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}
