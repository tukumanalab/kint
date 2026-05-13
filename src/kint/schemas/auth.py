"""認証スキーマ。"""

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

_ACCOUNT_ID_RE = re.compile(r"^[A-Za-z0-9_.@+-]+$")


class LoginRequest(BaseModel):
    """ログインリクエスト。"""

    account_id: str
    password: str

    @field_validator("account_id")
    @classmethod
    def validate_account_id(cls, v: str) -> str:
        """アカウントIDを英数記号 3〜50 文字で検証する。"""
        v = v.strip()
        if not 3 <= len(v) <= 50:
            raise ValueError("account_id は 3〜50 文字で入力してください")
        if not _ACCOUNT_ID_RE.fullmatch(v):
            raise ValueError("account_id は英数字と記号 _.@+- のみ使用できます")
        return v


class UserProfile(BaseModel):
    """ログインユーザープロファイル。"""

    id: str
    role: Literal["admin", "employee"]
    name: str
    full_name: str
    email: str
    email_verified_at: datetime | None = None
    email_verification_status: Literal["pending", "verified"] = "pending"

    model_config = {"from_attributes": True}

    @field_validator("email_verification_status", mode="before")
    @classmethod
    def derive_status(cls, v: str | None, info: object) -> str:
        # email_verified_at の有無から status を導出する
        return v if v is not None else "pending"

    @classmethod
    def model_validate(cls, obj: object, **kwargs: object) -> "UserProfile":
        """User ORM から変換する際に email_verification_status を導出する。"""
        from kint.models.user import User  # 循環インポート回避

        if isinstance(obj, User):
            status = "verified" if obj.email_verified_at is not None else "pending"
            return cls(
                id=obj.id,
                role=obj.role,
                name=obj.name,
                full_name=obj.full_name,
                email=obj.email,
                email_verified_at=obj.email_verified_at,
                email_verification_status=status,
            )
        return super().model_validate(obj, **kwargs)


class GoogleLoginRequest(BaseModel):
    """Google ID Token ログインリクエスト。"""

    id_token: str


class RegisterRequest(BaseModel):
    """新規ユーザー登録リクエスト。"""

    id_token: str
    admin_password: str | None = None


class LoginResponse(BaseModel):
    """ログインレスポンス。"""

    access_token: str
    token_type: Literal["bearer"]
    user: UserProfile
