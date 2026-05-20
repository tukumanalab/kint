"""シフトカレンダールーター。管理者専用の同期エンドポイントを提供する。"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db, AsyncSessionLocal
from kint.dependencies import get_current_user
from kint.exceptions import KintBadRequestError, KintForbiddenError
from kint.models.user import User
from kint.services.calendar_sync import CalendarSyncError, CalendarSyncService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shifts", tags=["Shifts"])


def _require_admin(current_user: User) -> None:
    """管理者以外のアクセスを拒否する。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="管理者権限が必要です",
        )


async def _run_sync_in_background() -> None:
    """バックグラウンドタスクとして iCal 同期を実行する。"""
    async with AsyncSessionLocal() as session:
        service = CalendarSyncService(session)
        try:
            stats = await service.sync()
            logger.info("バックグラウンド同期完了: %s", stats)
        except CalendarSyncError as exc:
            logger.error("バックグラウンド同期失敗: %s", exc)
        except Exception as exc:
            logger.exception("バックグラウンド同期で予期しないエラー: %s", exc)


@router.post("/sync", status_code=202)
async def sync_shifts(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """iCal URL からシフトデータを取得し DB と同期する。管理者専用。非同期受理 (202)。"""
    _require_admin(current_user)
    background_tasks.add_task(_run_sync_in_background)
    return JSONResponse(
        status_code=202,
        content={"accepted": True, "message": "シフト同期を開始しました"},
    )
