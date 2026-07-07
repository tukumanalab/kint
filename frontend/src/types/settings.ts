export type AlertTarget =
  | 'check_in_time'
  | 'check_out_time'
  | 'daily_working_hours'
  | 'weekly_working_days'
  | 'weekly_working_hours';

export type AlertOperator = '<' | '<=' | '>' | '>=';

export interface AlertRule {
  id: string;
  target: AlertTarget;
  operator: AlertOperator;
  threshold_value: string | number;
  message: string;
}

export interface SystemSettings {
  punch_cooldown_seconds: number;
  shift_checkin_early_minutes: number;
  shift_ical_url: string | null;
  shift_sync_time: string | null;
  site_name: string;
  site_subtitle: string;
  punch_result_display_seconds: number;
  monthly_report_time: string | null;
  login_token_expire_hours: number;
  enable_google_signup: boolean;
  overtime_allowance_minutes: number;
  attendance_alert_rules: AlertRule[];
}

export interface SettingsPatchRequest {
  punch_cooldown_seconds?: number;
  shift_checkin_early_minutes?: number;
  shift_ical_url?: string | null;
  shift_sync_time?: string | null;
  site_name?: string;
  site_subtitle?: string;
  punch_result_display_seconds?: number;
  monthly_report_time?: string | null;
  login_token_expire_hours?: number;
  enable_google_signup?: boolean;
  overtime_allowance_minutes?: number;
  attendance_alert_rules?: AlertRule[];
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
