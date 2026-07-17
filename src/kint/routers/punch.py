"""打刻ルーター。打刻登録とカード忘れ打刻向け公開ユーザー検索を提供する。"""

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.schemas.punch import PunchRequest, PunchResponse, PunchUserCandidateListResponse
from kint.services.attendance import PunchService
from kint.services.punch_device import PunchDeviceService
from kint.services.user import UserService

router = APIRouter(prefix="/punches", tags=["Punch"])


@router.get("/users", response_model=PunchUserCandidateListResponse)
async def search_punch_users(
    q: str = Query(..., min_length=1, max_length=100),
    session: AsyncSession = Depends(get_db),
) -> PunchUserCandidateListResponse:
    """カード忘れ打刻向けに公開ユーザー候補を返す。"""
    service = UserService(session)
    return await service.search_punch_candidates(q)


@router.post("", response_model=PunchResponse, status_code=200)
async def punch(
    body: PunchRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    x_punch_device_token: str | None = Header(default=None, alias="X-Punch-Device-Token"),
    session: AsyncSession = Depends(get_db),
) -> PunchResponse:
    """Desktop アプリから打刻を登録する。NFC（card_idm）または user_id+reason に対応。"""
    device_name = None
    if x_punch_device_token:
        verify_result = PunchDeviceService.verify_device_token(x_punch_device_token)
        if verify_result.valid:
            device_name = verify_result.name

    service = PunchService(session)
    return await service.punch(body, device_name=device_name)
