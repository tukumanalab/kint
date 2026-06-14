"""打刻リクエスト・レスポンススキーマ。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, model_validator


class PunchRequest(BaseModel):
    """打刻リクエスト。card_idm または user_id+reason のいずれかが必須。"""

    device_id: str
    occurred_at: datetime
    confirm: bool = False
    card_idm: str | None = None
    user_id: str | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def validate_punch_method(self) -> "PunchRequest":
        """card_idm または user_id+reason のいずれかを検証する。"""
        if self.card_idm is not None:
            return self
        if self.user_id is not None:
            if not self.reason or not self.reason.strip():
                raise ValueError("user_id 打刻時は reason が必須です")
            return self
        raise ValueError("card_idm または user_id のいずれかを指定してください")


class PunchResponse(BaseModel):
    """打刻レスポンス。"""

    status: Literal["completed", "requires_confirmation"] = "completed"
    attendance_id: str | None = None
    user_id: str
    user_name: str
    action: Literal["check_in", "check_out", "cancelled"] | None = None
    occurred_at: datetime
    method: Literal["card_idm", "user_id"]
    message: str
    calculated_time: datetime | None = None
    current_working_hours: float | None = None
    daily_working_hours_total: float | None = None
    has_unread_notifications: bool = False



class PunchUserCandidate(BaseModel):
    """カード忘れ打刻用の公開ユーザー候補。"""

    id: str
    name: str
    full_name: str

    model_config = {"from_attributes": True}


class PunchUserCandidateListResponse(BaseModel):
    """カード忘れ打刻用の公開ユーザー候補一覧。"""

    users: list[PunchUserCandidate]
