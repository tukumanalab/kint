"""ユーザー一括保存・復元用のスキーマ。"""

from datetime import datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, Field


class CardBackupSchema(BaseModel):
    """一括保存用のカード情報。"""

    card_idm: str
    name: Optional[str] = None
    is_active: bool = True


class UserBackupSchema(BaseModel):
    """一括保存用のユーザー情報。"""

    id: str
    name: str
    full_name: str
    email: str
    password_hash: Optional[str] = None
    google_sub: Optional[str] = None
    role: Literal["admin", "employee"]
    google_calendar_id: Optional[str] = None
    email_verified_at: Optional[datetime] = None
    is_active: bool = True
    cards: List[CardBackupSchema] = Field(default_factory=list)


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
    errors: List[ImportErrorItem]
