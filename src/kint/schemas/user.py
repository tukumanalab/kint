"""ユーザー管理スキーマ。"""

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, field_validator, model_validator

_PASSWORD_RE = re.compile(r"(?=.*[a-zA-Z])(?=.*\d)")


class UserCreateRequest(BaseModel):
    """ユーザー作成リクエスト。"""

    name: str
    full_name: str
    email: EmailStr
    role: Literal["admin", "employee"]
    password: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        """前後空白を除去し 1〜50 文字であることを検証する。"""
        v = v.strip()
        if not 1 <= len(v) <= 50:
            raise ValueError("name は 1〜50 文字で入力してください")
        return v

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str) -> str:
        """前後空白を除去し 1〜100 文字であることを検証する。"""
        v = v.strip()
        if not 1 <= len(v) <= 100:
            raise ValueError("full_name は 1〜100 文字で入力してください")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        """8〜72 文字かつ英字・数字を各 1 文字以上含むことを検証する。"""
        if not 8 <= len(v) <= 72:
            raise ValueError("password は 8〜72 文字で入力してください")
        if not _PASSWORD_RE.search(v):
            raise ValueError("password は英字と数字をそれぞれ 1 文字以上含める必要があります")
        return v


class UserPatchRequest(BaseModel):
    """ユーザー修正リクエスト。最低 1 フィールドが必要。"""

    name: str | None = None
    full_name: str | None = None
    email: EmailStr | None = None
    role: Literal["admin", "employee"] | None = None
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        """前後空白を除去し 1〜50 文字であることを検証する。"""
        if v is None:
            return v
        v = v.strip()
        if not 1 <= len(v) <= 50:
            raise ValueError("name は 1〜50 文字で入力してください")
        return v

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, v: str | None) -> str | None:
        """前後空白を除去し 1〜100 文字であることを検証する。"""
        if v is None:
            return v
        v = v.strip()
        if not 1 <= len(v) <= 100:
            raise ValueError("full_name は 1〜100 文字で入力してください")
        return v

    @model_validator(mode="after")
    def at_least_one_field(self) -> "UserPatchRequest":
        """更新フィールドが 1 つ以上あることを検証する。"""
        if all(
            v is None for v in (self.name, self.full_name, self.email, self.role, self.is_active)
        ):
            raise ValueError("更新するフィールドを 1 つ以上指定してください")
        return self


class UserResponse(BaseModel):
    """ユーザーレスポンス。"""

    id: str
    name: str
    full_name: str
    email: str
    role: Literal["admin", "employee"]
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("is_active", mode="before")
    @classmethod
    def coerce_int_to_bool(cls, v: int | bool) -> bool:
        """SQLite は is_active を INTEGER で保持するため bool に変換する。"""
        return bool(v)
