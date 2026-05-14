"""ユーザー管理スキーマ。"""

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, field_validator, model_validator


class MeCardRegistrationRequest(BaseModel):
    """本人NFCカード登録リクエスト。"""

    card_idm: str
    name: str | None = None


class MeCardRegistrationResponse(BaseModel):
    """本人NFCカード登録レスポンス。"""

    card_id: str
    card_idm: str
    name: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class MeCardListItem(BaseModel):
    """本人NFCカード一覧アイテム。"""

    card_id: str
    card_idm: str
    name: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class MeCardPatchRequest(BaseModel):
    """本人NFCカード名変更リクエスト。"""

    name: str | None = None

_PASSWORD_RE = re.compile(r"(?=.*[a-zA-Z])(?=.*\d)")
_ACCOUNT_ID_RE = re.compile(r"^[A-Za-z0-9_.@+-]+$")


class UserCreateRequest(BaseModel):
    """ユーザー作成リクエスト。"""

    id: str
    name: str
    full_name: str
    email: EmailStr
    role: Literal["admin", "employee"]

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        """アカウントIDを英数記号 3〜50 文字で検証する。"""
        v = v.strip()
        if not 3 <= len(v) <= 50:
            raise ValueError("id は 3〜50 文字で入力してください")
        if not _ACCOUNT_ID_RE.fullmatch(v):
            raise ValueError("id は英数字と記号 _.@+- のみ使用できます")
        return v

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


class UsersListResponse(BaseModel):
    """ユーザー一覧レスポンス。"""

    users: list[UserResponse]


class MeProfileUpdateRequest(BaseModel):
    """マイページ プロフィール更新リクエスト（name / full_name のみ更新可能）。"""

    name: str | None = None
    full_name: str | None = None

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
    def at_least_one_field(self) -> "MeProfileUpdateRequest":
        """更新フィールドが 1 つ以上あることを検証する。"""
        if all(v is None for v in (self.name, self.full_name)):
            raise ValueError("更新するフィールドを 1 つ以上指定してください")
        return self


class EmailChangeRequestCreate(BaseModel):
    """メールアドレス変更リクエスト。"""

    new_email: EmailStr


class EmailChangeAcceptedResponse(BaseModel):
    """メールアドレス変更受付レスポンス。"""

    status: Literal["pending_confirmation"]
    requested_email: str
    expires_at: datetime


class EmailVerificationConfirmRequest(BaseModel):
    """メール確認トークン確定リクエスト。"""

    token: str

    @field_validator("token")
    @classmethod
    def validate_token(cls, v: str) -> str:
        """空文字を拒否する。"""
        if not v.strip():
            raise ValueError("token は必須です")
        return v


class EmailVerificationConfirmResponse(BaseModel):
    """メール確認完了レスポンス。"""

    verification_type: Literal["signup", "email_change"]
    email: str
    status: Literal["confirmed"]


class PasswordChangeRequest(BaseModel):
    """パスワード変更リクエスト。"""

    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        """8〜72 文字かつ英字・数字を各 1 文字以上含むことを検証する。"""
        if not 8 <= len(v) <= 72:
            raise ValueError("new_password は 8〜72 文字で入力してください")
        if not _PASSWORD_RE.search(v):
            raise ValueError("new_password は英字と数字をそれぞれ 1 文字以上含める必要があります")
        return v

    @model_validator(mode="after")
    def passwords_differ(self) -> "PasswordChangeRequest":
        """新旧パスワードが同一の場合はエラー。"""
        if self.current_password == self.new_password:
            raise ValueError("new_password は current_password と異なる必要があります")
        return self
