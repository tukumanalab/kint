"""認証スキーマ。"""

import re
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

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    """ログインレスポンス。"""

    access_token: str
    token_type: Literal["bearer"]
    user: UserProfile
