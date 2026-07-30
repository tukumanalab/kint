"""勤務時間報告書用 Pydantic スキーマ。"""

from datetime import date

from pydantic import BaseModel


class WorkingHoursReportDayItem(BaseModel):
    """勤務時間報告書の日別項目。"""

    date: date
    day_of_week_label: str  # 例: "1(水)"
    is_weekend: bool = False
    start_time: str | None = None  # 例: "13:00"
    end_time: str | None = None  # 例: "18:00"
    break_time_str: str | None = None  # 例: "1:00"
    actual_work_time_str: str | None = None  # 例: "5:00" (実打刻の実時間)
    requested_work_hours: float = 0.0  # 申請勤務時間(10進数)
    work_content: str | None = None  # 例: "青学つくまなラボ 利用者対応"
    remarks: str | None = None  # 備考


class WorkingHoursReportUserInfo(BaseModel):
    """対象ユーザーの基本情報。"""

    user_id: str
    full_name: str
    name_kana: str | None = None
    department: str | None = None
    worker_id: str | None = None


class WorkingHoursReportResponse(BaseModel):
    """勤務時間報告書全体のレスポンス。"""

    year: int
    month: int
    year_month: str
    title: str  # 例: "2026年 7月分 教学系予算パートタイム職員等勤務時間報告書"
    user: WorkingHoursReportUserInfo
    days: list[WorkingHoursReportDayItem]
    total_actual_work_time_str: str  # 例: "(15:00)" (実時間の合計)
    total_requested_work_hours: float  # 例: 15.0 (申請勤務時間の合計)
