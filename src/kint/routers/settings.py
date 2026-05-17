"""システム設定 API ルーター。GET/PATCH /api/v1/settings および export/import を提供する。"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.dependencies import get_current_user
from kint.exceptions import KintForbiddenError
from kint.models.user import User
from kint.schemas.settings import (
    SettingsExportFile,
    SettingsImportRequest,
    SettingsImportResult,
    SettingsPatchRequest,
    SettingsResponse,
)
from kint.services.settings import SettingsService

router = APIRouter(prefix="/settings", tags=["Settings"])


def _require_admin(current_user: User) -> User:
    """管理者ロールを要求する。非管理者なら KintForbiddenError を送出する。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="管理者のみアクセスできます",
        )
    return current_user


@router.get("", response_model=SettingsResponse)
async def get_settings(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SettingsResponse:
    """現在の全設定値を返す。DB 未設定のキーは環境変数またはデフォルト値を返す。"""
    _require_admin(current_user)
    service = SettingsService(session)
    return await service.get_all()


@router.patch("", response_model=SettingsResponse)
async def patch_settings(
    body: SettingsPatchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SettingsResponse:
    """指定したキーの設定値を更新（upsert）し、更新後の全設定値を返す。"""
    _require_admin(current_user)
    service = SettingsService(session)
    return await service.upsert(body, actor_id=current_user.id)


@router.get("/export", response_model=SettingsExportFile)
async def export_settings(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> JSONResponse:
    """現在の設定値をメタデータ付き JSON ファイルとしてダウンロードする。"""
    _require_admin(current_user)
    service = SettingsService(session)
    export_file = await service.export(actor_email=current_user.email)
    filename = f"kint-settings-{datetime.now(tz=UTC).strftime('%Y%m%d')}.json"
    return JSONResponse(
        content=export_file.model_dump(),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", response_model=SettingsImportResult)
async def import_settings(
    body: SettingsImportRequest,
    dry_run: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> SettingsImportResult:
    """エクスポートファイルから設定値を一括適用する。dry_run=true のとき DB 書き込みなし。"""
    _require_admin(current_user)
    service = SettingsService(session)
    if dry_run:
        return await service.import_preview(body)
    return await service.import_apply(body, actor_id=current_user.id)
