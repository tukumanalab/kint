"""打刻ルーター。POST /api/v1/punches を提供する。"""

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.schemas.punch import PunchRequest, PunchResponse
from kint.services.attendance import PunchService

router = APIRouter(prefix="/punches", tags=["Punch"])


@router.post("", response_model=PunchResponse, status_code=200)
async def punch(
    body: PunchRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    session: AsyncSession = Depends(get_db),
) -> PunchResponse:
    """Desktop アプリから打刻を登録する。NFC（card_idm）または user_id+reason に対応。"""
    service = PunchService(session)
    return await service.punch(body)
