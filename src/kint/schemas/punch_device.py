"""打刻端末管理スキーマ。"""

from pydantic import BaseModel


class PunchDeviceTokenRequest(BaseModel):
    """デバイストークン発行リクエスト。"""

    name: str


class PunchDeviceTokenResponse(BaseModel):
    """デバイストークン発行レスポンス。"""

    device_token: str
    name: str


class PunchDeviceVerifyResponse(BaseModel):
    """デバイストークン検証レスポンス。"""

    valid: bool
    name: str | None = None
