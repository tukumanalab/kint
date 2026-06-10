"""打刻端末管理ルーター。"""

from fastapi import APIRouter, Depends, Header

from kint.dependencies import get_current_user
from kint.exceptions import KintForbiddenError
from kint.models.user import User
from kint.schemas.punch_device import (
    PunchDeviceTokenRequest,
    PunchDeviceTokenResponse,
    PunchDeviceVerifyResponse,
)
from kint.services.punch_device import PunchDeviceService

router = APIRouter(prefix="/punch-devices", tags=["PunchDevice"])


def _require_admin(current_user: User) -> None:
    """管理者以外のアクセスを拒否する。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="管理者権限が必要です",
        )


@router.post("/token", response_model=PunchDeviceTokenResponse)
async def create_token(
    body: PunchDeviceTokenRequest,
    current_user: User = Depends(get_current_user),
) -> PunchDeviceTokenResponse:
    """管理者としてログインし、端末名から打刻用デバイストークン(JWT)を発行する。"""
    _require_admin(current_user)
    return PunchDeviceService.create_device_token(body.name)


@router.get("/verify", response_model=PunchDeviceVerifyResponse)
async def verify_token(
    x_punch_device_token: str | None = Header(default=None, alias="X-Punch-Device-Token"),
) -> PunchDeviceVerifyResponse:
    """デバイストークンの有効性を検証する。"""
    if not x_punch_device_token:
        return PunchDeviceVerifyResponse(valid=False, name=None)
    return PunchDeviceService.verify_device_token(x_punch_device_token)
