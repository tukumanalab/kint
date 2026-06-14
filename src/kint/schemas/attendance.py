"""勤怠スキーマ。"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class AttendanceRecord(BaseModel):
    """勤怠レコード。"""

    id: str
    user_id: str
    card_idm: str | None = None
    work_date: date
    check_in: datetime | None = None
    check_out: datetime | None = None
    source: Literal["webusb_nfc", "web_user_id", "admin_manual", "self_service"]
    updated_reason: str | None = None
    is_auto_completed: bool = False
    auto_completed_at: datetime | None = None
    last_updated_at: datetime | None = None
    last_updated_by_user_id: str | None = None

    model_config = {"from_attributes": True}


class AttendanceCreateRequest(BaseModel):
    """管理者による勤怠記録追加リクエスト。"""

    user_id: str
    work_date: date
    check_in: datetime | None = None
    check_out: datetime | None = None
    reason: str


class AttendancePatchRequest(BaseModel):
    """勤怠修正リクエスト。reason は必須。"""

    check_in: datetime | None = None
    check_out: datetime | None = None
    reason: str


class AttendanceHistorySnapshot(BaseModel):
    """変更前後のスナップショット。"""

    check_in: datetime | None = None
    check_out: datetime | None = None


class AttendanceHistoryEntry(BaseModel):
    """勤怠変更履歴の1件。"""

    id: str
    attendance_id: str
    actor_user_id: str
    actor_role: Literal["admin", "employee"]
    changed_at: datetime
    before: AttendanceHistorySnapshot
    after: AttendanceHistorySnapshot
    reason: str

    model_config = {"from_attributes": True}


class AttendanceListResponse(BaseModel):
    """勤怠一覧レスポンス。"""

    items: list[AttendanceRecord]
    page: int
    page_size: int
    total: int


class AttendanceHistoryResponse(BaseModel):
    """勤怠変更履歴レスポンス。"""

    items: list[AttendanceHistoryEntry]
    total: int


class AttendanceMonthlySummary(BaseModel):
    """月次勤怠サマリー。"""

    user_id: str
    user_name: str
    full_name: str
    prescribed_days: int
    working_days: int
    total_working_hours: float
    total_overtime_hours: float
    late_count: int
    early_leave_count: int
    absence_days: int
    incomplete_days: int


class PunchPeriod(BaseModel):
    """1回分の出退勤打刻ペア。"""

    attendance_id: str | None = None
    check_in: datetime | None = None
    check_out: datetime | None = None
    calculated_check_in: datetime | None = None
    calculated_check_out: datetime | None = None
    source: str | None = None


class DailyAttendanceDetail(BaseModel):
    """日次勤怠詳細。"""

    work_date: date
    attendance_id: str | None = None
    has_shift: bool
    is_holiday: bool
    shift_start: datetime | None = None
    shift_end: datetime | None = None
    check_in: datetime | None = None
    check_out: datetime | None = None
    calculated_check_in: datetime | None = None
    calculated_check_out: datetime | None = None
    working_hours: float | None = None
    overtime_hours: float | None = None
    status: Literal[
        "normal",
        "late",
        "early_leave",
        "late_and_early",
        "absence",
        "incomplete",
        "off_duty",
    ]
    source: str | None = None
    is_auto_completed: bool = False
    punches: list[PunchPeriod] = []


class AttendanceMonthlyDetailResponse(BaseModel):
    """月間日別勤怠詳細レスポンス。"""

    user_id: str
    year_month: str
    summary: AttendanceMonthlySummary
    days: list[DailyAttendanceDetail]
    is_locked: bool = False


class AttendanceCorrectionRequestCreate(BaseModel):
    """勤怠修正申請作成リクエスト。"""

    attendance_id: str
    requested_check_in: datetime | None = None
    requested_check_out: datetime | None = None
    reason: str


class AttendanceCorrectionRequestResponse(BaseModel):
    """勤怠修正申請レスポンス。"""

    id: str
    attendance_id: str
    user_id: str
    requested_check_in: datetime | None = None
    requested_check_out: datetime | None = None
    reason: str
    status: Literal["pending", "approved", "rejected"]
    approved_by_user_id: str | None = None
    approval_comment: str | None = None
    created_at: datetime
    updated_at: datetime
    user_name: str | None = None
    user_full_name: str | None = None
    approved_by_name: str | None = None
    work_date: date | None = None
    original_check_in: datetime | None = None
    original_check_out: datetime | None = None

    model_config = {"from_attributes": True}


class AttendanceCorrectionRequestListResponse(BaseModel):
    """勤怠修正申請一覧。"""

    items: list[AttendanceCorrectionRequestResponse]
    total: int


class AttendanceCorrectionRequestApprove(BaseModel):
    """申請承認リクエスト。"""

    approval_comment: str | None = None


class AttendanceCorrectionRequestReject(BaseModel):
    """申請却下リクエスト（理由必須）。"""

    approval_comment: str


class AttendanceLockRequest(BaseModel):
    """勤怠締め処理リクエスト。"""

    year_month: str


class AttendanceLockResponse(BaseModel):
    """勤怠締め処理レスポンス。"""

    year_month: str
    locked_at: datetime
    locked_by_user_id: str

    model_config = {"from_attributes": True}
