import { ApiError } from '../types/error';
import type { ErrorResponse } from '../types/error';
import type {
  SettingsExportFile,
  SettingsImportResult,
  SettingsPatchRequest,
  SystemSettings,
} from '../types/settings';

const BASE = '/api/v1';

async function request<T>(path: string, init: RequestInit, token: string): Promise<T> {
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

export interface PublicSettings {
  site_name: string;
  site_subtitle: string;
  punch_result_display_seconds: number;
  enable_google_signup: boolean;
}

export async function getPublicSettings(): Promise<PublicSettings> {
  const res = await fetch(`${BASE}/settings/public`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({
      code: 'unknown',
      message: res.statusText,
    }));
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<PublicSettings>;
}

export async function getSettings(token: string): Promise<SystemSettings> {
  return request<SystemSettings>('/settings', { method: 'GET' }, token);
}

export async function patchSettings(
  token: string,
  req: SettingsPatchRequest,
): Promise<SystemSettings> {
  return request<SystemSettings>(
    '/settings',
    { method: 'PATCH', body: JSON.stringify(req) },
    token,
  );
}

/** 設定値をエクスポートして JSON ファイルとしてダウンロードする。 */
export async function exportSettings(token: string): Promise<void> {
  const res = await fetch(`${BASE}/settings/export`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({
      code: 'unknown',
      message: res.statusText,
    }));
    throw new ApiError(res.status, body);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? 'kint-settings.json';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function previewImportSettings(
  token: string,
  file: SettingsExportFile,
): Promise<SettingsImportResult> {
  return request<SettingsImportResult>(
    '/settings/import?dry_run=true',
    { method: 'POST', body: JSON.stringify(file) },
    token,
  );
}

export async function applyImportSettings(
  token: string,
  file: SettingsExportFile,
): Promise<SettingsImportResult> {
  return request<SettingsImportResult>(
    '/settings/import',
    { method: 'POST', body: JSON.stringify(file) },
    token,
  );
}

/** データベースのフルバックアップをダウンロードする */
export async function exportDatabaseBackup(token: string): Promise<void> {
  const res = await fetch(`${BASE}/settings/database/backup`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({
      code: 'unknown',
      message: res.statusText,
    }));
    throw new ApiError(res.status, body);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? 'kint-backup.db';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** データベースのフルバックアップを復元する */
export async function restoreDatabaseBackup(token: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BASE}/settings/database/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const body: ErrorResponse = await res.json().catch(() => ({
      code: 'unknown',
      message: res.statusText,
    }));
    throw new ApiError(res.status, body);
  }
}
