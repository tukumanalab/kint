import type { UserProfile } from '../types/auth';
import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';
import type {
  MeProfileUpdateRequest,
  EmailChangeRequestCreate,
  EmailChangeRequestAcceptedResponse,
  PasswordChangeRequest,
  EmailVerificationConfirmRequest,
  EmailVerificationConfirmResponse,
} from '../types/user';

const BASE = '/api/v1';

async function request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, { headers, ...init });
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

export async function fetchMyProfile(token: string): Promise<UserProfile> {
  return request<UserProfile>('/me', { method: 'GET' }, token);
}

export async function updateMyProfile(
  token: string,
  payload: MeProfileUpdateRequest,
): Promise<UserProfile> {
  return request<UserProfile>(
    '/me/profile',
    { method: 'PATCH', body: JSON.stringify(payload) },
    token,
  );
}

export async function requestEmailChange(
  token: string,
  payload: EmailChangeRequestCreate,
): Promise<EmailChangeRequestAcceptedResponse> {
  return request<EmailChangeRequestAcceptedResponse>(
    '/me/email-change-requests',
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export async function changePassword(
  token: string,
  payload: PasswordChangeRequest,
): Promise<void> {
  return request<void>(
    '/me/password',
    { method: 'PATCH', body: JSON.stringify(payload) },
    token,
  );
}

export async function confirmEmailVerification(
  payload: EmailVerificationConfirmRequest,
): Promise<EmailVerificationConfirmResponse> {
  return request<EmailVerificationConfirmResponse>(
    '/email-verifications/confirm',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}
