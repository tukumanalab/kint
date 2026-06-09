"""ユーザー一括保存・復元用のスキーマ。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CardBackupSchema(BaseModel):
    """一括保存用のカード情報。"""

    card_idm: str
    name: str | None = None
    is_active: bool = True


class UserBackupSchema(BaseModel):
    """一括保存用のユーザー情報。"""

    id: str
    name: str
    full_name: str
    email: str
    google_sub: str | None = None
    role: Literal["admin", "employee"]
    google_calendar_id: str | None = None
    email_verified_at: datetime | None = None
    is_active: bool = True
    cards: list[CardBackupSchema] = Field(default_factory=list)


class ImportErrorItem(BaseModel):
    """インポート時の個別エラー情報。"""

    id: str
    code: str
    message: str


class ImportResultSchema(BaseModel):
    """一括インポート処理結果。"""

    imported_count: int
    updated_count: int
    failed_count: int
    errors: list[ImportErrorItem]
