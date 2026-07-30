export interface WorkingHoursReportDayItem {
  date: string;
  day_of_week_label: string; // 例: "1(水)"
  is_weekend: boolean;
  start_time: string | null; // 例: "13:00"
  end_time: string | null; // 例: "18:00"
  break_time_str: string | null; // 例: "1:00"
  actual_work_time_str: string | null; // 例: "5:00"
  requested_work_hours: number;
  work_content: string | null;
  remarks: string | null;
}

export interface WorkingHoursReportUserInfo {
  user_id: string;
  full_name: string;
  name_kana: string | null;
  department: string | null;
  worker_id: string | null;
}

export interface WorkingHoursReportResponse {
  year: number;
  month: number;
  year_month: string;
  title: string;
  user: WorkingHoursReportUserInfo;
  days: WorkingHoursReportDayItem[];
  total_actual_work_time_str: string; // 例: "(15:00)"
  total_requested_work_hours: number; // 例: 15.0
}
