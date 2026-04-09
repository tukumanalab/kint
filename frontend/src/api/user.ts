import type {
  UserCreateRequest,
  UserPatchRequest,
  UserResponse,
  UsersListResponse,
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

export async function deleteUser(token: string, userId: string): Promise<void> {
  return request<void>(`/users/${userId}`, { method: 'DELETE' }, token);
}
