"""顔認証打刻ルーター。打刻端末（X-Punch-Device-Token）向けの設定取得・顔照合を提供する。"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.exceptions import KintForbiddenError, KintUnauthorizedError
from kint.schemas.face import FaceIdentifyRequest, FaceIdentifyResponse, FacePunchConfig
from kint.services.face import FaceService
from kint.services.punch_device import PunchDeviceService
from kint.services.settings import SettingsService

router = APIRouter(prefix="/face-punch", tags=["FacePunch"])


def _require_device(x_punch_device_token: str | None) -> None:
    """打刻端末トークンを検証する。未指定・無効なら KintUnauthorizedError (401)。"""
    if not x_punch_device_token:
        raise KintUnauthorizedError(
            code="DEVICE_TOKEN_REQUIRED", message="打刻端末トークンが必要です"
        )
    result = PunchDeviceService.verify_device_token(x_punch_device_token)
    if not result.valid:
        raise KintUnauthorizedError(
            code="DEVICE_TOKEN_INVALID", message="打刻端末トークンが無効です"
        )


@router.get("/config", response_model=FacePunchConfig)
async def get_face_punch_config(
    x_punch_device_token: str | None = Header(default=None, alias="X-Punch-Device-Token"),
    session: AsyncSession = Depends(get_db),
) -> FacePunchConfig:
    """顔認証打刻の有効状態・カウントダウン秒・クールダウン秒を返す。"""
    _require_device(x_punch_device_token)
    settings_svc = SettingsService(session)
    enabled = await settings_svc.get_bool("face_punch_enabled")
    countdown_seconds = await settings_svc.get_int("face_punch_countdown_seconds")
    cooldown_seconds = await settings_svc.get_int("punch_cooldown_seconds")
    return FacePunchConfig(
        enabled=enabled,
        countdown_seconds=countdown_seconds,
        cooldown_seconds=cooldown_seconds,
    )


@router.post("/identify", response_model=FaceIdentifyResponse)
async def identify_face(
    body: FaceIdentifyRequest,
    x_punch_device_token: str | None = Header(default=None, alias="X-Punch-Device-Token"),
    session: AsyncSession = Depends(get_db),
) -> FaceIdentifyResponse:
    """顔ディスクリプタから打刻対象ユーザーを照合し、一致すれば短命の打刻トークンを返す。"""
    _require_device(x_punch_device_token)
    settings_svc = SettingsService(session)
    if not await settings_svc.get_bool("face_punch_enabled"):
        raise KintForbiddenError(
            code="FACE_PUNCH_DISABLED", message="顔認証打刻は無効化されています"
        )

    service = FaceService(session)
    return await service.identify(body.descriptor, datetime.now(tz=UTC))
