import type {
  UserCreateRequest,
  UserPatchRequest,
  UserResponse,
  UsersListResponse,
  MeCardListItem,
  MeCardRegistrationRequest,
  MeCardRegistrationResponse,
  MeCardPatchRequest,
} from '../types/user';
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

export async function getUsers(token: string): Promise<UsersListResponse> {
  return request<UsersListResponse>('/users', { method: 'GET' }, token);
}

export async function createUser(
  token: string,
  payload: UserCreateRequest,
): Promise<UserResponse> {
  return request<UserResponse>('/users', { method: 'POST', body: JSON.stringify(payload) }, token);
}

export async function patchUser(
  token: string,
  userId: string,
  payload: UserPatchRequest,
): Promise<UserResponse> {
  return request<UserResponse>(
    `/users/${userId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    token,
  );
}

export async function deleteUser(token: string, userId: string, hard = false): Promise<void> {
  const query = hard ? '?hard=true' : '';
  return request<void>(`/users/${userId}${query}`, { method: 'DELETE' }, token);
}

export async function exportUsers(token: string): Promise<unknown[]> {
  return request<unknown[]>('/users/export', { method: 'GET' }, token);
}

export async function importUsers(
  token: string,
  payload: unknown[],
): Promise<{
  imported_count: number;
  updated_count: number;
  failed_count: number;
  errors: Array<{ id: string; code: string; message: string }>;
}> {
  return request('/users/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export async function fetchUserCards(token: string, userId: string): Promise<MeCardListItem[]> {
  return request<MeCardListItem[]>(`/users/${encodeURIComponent(userId)}/cards`, { method: 'GET' }, token);
}

export async function registerUserCard(
  token: string,
  userId: string,
  payload: MeCardRegistrationRequest,
): Promise<MeCardRegistrationResponse> {
  return request<MeCardRegistrationResponse>(
    `/users/${encodeURIComponent(userId)}/cards`,
    { method: 'POST', body: JSON.stringify(payload) },
    token,
  );
}

export async function renameUserCard(
  token: string,
  userId: string,
  cardId: string,
  payload: MeCardPatchRequest,
): Promise<MeCardListItem> {
  return request<MeCardListItem>(
    `/users/${encodeURIComponent(userId)}/cards/${encodeURIComponent(cardId)}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    token,
  );
}

export async function deleteUserCard(
  token: string,
  userId: string,
  cardId: string,
): Promise<void> {
  return request<void>(
    `/users/${encodeURIComponent(userId)}/cards/${encodeURIComponent(cardId)}`,
    { method: 'DELETE' },
    token,
  );
}
