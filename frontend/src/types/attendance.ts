export interface AttendanceMonthlySummary {
  user_id: string;
  user_name: string;
  full_name: string;
  prescribed_days: number;
  working_days: number;
  total_working_hours: number;
  total_overtime_hours: number;
  late_count: number;
  early_leave_count: number;
  absence_days: number;
  incomplete_days: number;
}

export type DailyAttendanceStatus =
  | 'normal'
  | 'late'
  | 'early_leave'
  | 'late_and_early'
  | 'absence'
  | 'incomplete'
  | 'off_duty';

export interface PunchPeriod {
  check_in: string | null;
  check_out: string | null;
}

export interface DailyAttendanceDetail {
  work_date: string; // ISO 8601 YYYY-MM-DD
  has_shift: boolean;
  is_holiday: boolean;
  shift_start: string | null; // ISO 8601
  shift_end: string | null; // ISO 8601
  check_in: string | null; // ISO 8601
  check_out: string | null; // ISO 8601
  working_hours: number | null;
  overtime_hours: number | null;
  status: DailyAttendanceStatus;
  source: string | null;
  punches?: PunchPeriod[];
}

export interface AttendanceMonthlyDetailResponse {
  user_id: string;
  year_month: string;
  summary: AttendanceMonthlySummary;
  days: DailyAttendanceDetail[];
}
