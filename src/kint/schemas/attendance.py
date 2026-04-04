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
    source: Literal["desktop_nfc", "desktop_user_id", "admin_manual", "self_service"]
    updated_reason: str | None = None
    last_updated_at: datetime | None = None
    last_updated_by_user_id: str | None = None

    model_config = {"from_attributes": True}


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
