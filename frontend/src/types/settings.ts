export interface SystemSettings {
  punch_cooldown_seconds: number;
  shift_checkin_early_minutes: number;
  shift_ical_url: string | null;
}

export interface SettingsPatchRequest {
  punch_cooldown_seconds?: number;
  shift_checkin_early_minutes?: number;
  shift_ical_url?: string | null;
}

export interface SettingsExportFile {
  version: string;
  exported_at: string; // ISO 8601
  exported_by: string; // メールアドレス
  settings: SystemSettings;
}

export interface SettingsImportChange {
  key: string;
  before: number | string | null;
  after: number | string | null;
}

export interface SettingsImportResult {
  dry_run: boolean;
  changes: SettingsImportChange[];
  ignored_keys: string[];
  warnings: string[];
  applied?: SystemSettings;
}
