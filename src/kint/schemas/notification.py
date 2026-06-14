"""お知らせリクエスト・レスポンススキーマ。"""

from datetime import datetime
from pydantic import BaseModel, field_validator


class NotificationResponse(BaseModel):
    """お知らせレスポンス。"""

    id: str
    user_id: str
    message: str
    is_read: bool
    category: str | None = None
    reference_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("created_at", mode="after")
    @classmethod
    def ensure_tz(cls, v: datetime) -> datetime:
        from datetime import UTC
        if v.tzinfo is None:
            return v.replace(tzinfo=UTC)
        return v


class NotificationListResponse(BaseModel):
    """お知らせ一覧レスポンス。"""

    items: list[NotificationResponse]
    unread_count: int
