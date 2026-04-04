"""認証スキーマ。"""

from typing import Literal

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    """ログインリクエスト。"""

    email: EmailStr
    password: str


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
