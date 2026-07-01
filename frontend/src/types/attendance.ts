export interface AttendanceMonthlySummary {
  user_id: string;
  user_name: string;
  full_name: string;
  email: string;
  prescribed_days: number;
  working_days: number;
  total_working_hours: number;
  total_overtime_hours: number;
  late_count: number;
  early_leave_count: number;
  absence_days: number;
  incomplete_days: number;
  yearly_working_hours: number;
}

export type DailyAttendanceStatus =
  | 'normal'
  | 'late'
  | 'early_leave'
  | 'late_and_early'
  | 'absence'
  | 'incomplete'
  | 'scheduled'
  | 'off_duty';

export interface PunchPeriod {
  attendance_id?: string | null;
  check_in: string | null;
  check_out: string | null;
  calculated_check_in?: string | null;
  calculated_check_out?: string | null;
  source?: string | null;
  overtime_reason?: string | null;
  is_manual_work_time?: boolean;
}

export interface DailyAttendanceDetail {
  work_date: string; // ISO 8601 YYYY-MM-DD
  attendance_id: string | null;
  has_shift: boolean;
  is_holiday: boolean;
  shift_start: string | null; // ISO 8601
  shift_end: string | null; // ISO 8601
  check_in: string | null; // ISO 8601
  check_out: string | null; // ISO 8601
  calculated_check_in: string | null; // ISO 8601
  calculated_check_out: string | null; // ISO 8601
  working_hours: number | null;
  overtime_hours: number | null;
  status: DailyAttendanceStatus;
  source: string | null;
  is_auto_completed?: boolean;
  is_manual_work_time?: boolean;
  punches?: PunchPeriod[];
  shifts?: { start_time: string; end_time: string }[];
}

export interface AttendanceMonthlyDetailResponse {
  user_id: string;
  year_month: string;
  summary: AttendanceMonthlySummary;
  days: DailyAttendanceDetail[];
  is_locked: boolean;
}

export interface AttendanceCorrectionRequest {
  id: string;
  attendance_id: string;
  user_id: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by_user_id: string | null;
  approval_comment: string | null;
  created_at: string;
  updated_at: string;
  user_name: string | null;
  user_full_name: string | null;
  approved_by_name: string | null;
  work_date: string | null;
  original_check_in?: string | null;
  original_check_out?: string | null;
}

export interface AttendanceCorrectionRequestListResponse {
  items: AttendanceCorrectionRequest[];
  total: number;
}

export interface AttendanceLock {
  year_month: string;
  locked_by_user_id: string;
  locked_at: string;
}

export interface AttendanceHistorySnapshot {
  check_in: string | null;
  check_out: string | null;
  work_start: string | null;
  work_end: string | null;
}

export interface AttendanceHistoryEntry {
  id: string;
  attendance_id: string;
  actor_user_id: string;
  actor_role: 'admin' | 'employee';
  changed_at: string;
  before: AttendanceHistorySnapshot;
  after: AttendanceHistorySnapshot;
  reason: string;
}

export interface AttendanceHistoryResponse {
  items: AttendanceHistoryEntry[];
  total: number;
}

export interface AttendanceRecord {
  id: string;
  user_id: string;
  card_idm: string | null;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  work_start: string | null;
  work_end: string | null;
  is_manual_work_time: boolean;
  source: 'webusb_nfc' | 'web_user_id' | 'admin_manual' | 'self_service';
  updated_reason: string | null;
  is_auto_completed: boolean;
  auto_completed_at: string | null;
  last_updated_at: string | null;
  last_updated_by_user_id: string | null;
  overtime_reason?: string | null;
}

