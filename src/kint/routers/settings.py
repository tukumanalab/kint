"""システム設定 API ルーター。GET/PATCH /api/v1/settings および export/import を提供する。"""

from datetime import UTC, datetime
import os
import shutil
import sqlite3
import tempfile

import asyncio
import anyio
import inspect
import aiosqlite
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
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
    PublicSettingsResponse,
)
from kint.services.settings import SettingsService

router = APIRouter(prefix="/settings", tags=["Settings"])


@router.get("/public", response_model=PublicSettingsResponse)
async def get_public_settings(
    session: AsyncSession = Depends(get_db),
) -> PublicSettingsResponse:
    """認証不要で取得できる公開設定（サイト名およびサブタイトル）を返す。"""
    service = SettingsService(session)
    site_name = await service.get_str("site_name")
    site_subtitle = await service.get_str("site_subtitle")
    return PublicSettingsResponse(
        site_name=site_name or "Kint",
        site_subtitle=site_subtitle or "NFC 勤怠管理システム",
    )


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


@router.get("/database/backup")
async def backup_database_api(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    """データベース全体のバックアップファイルをダウンロードする。"""
    _require_admin(current_user)

    temp_dir = tempfile.gettempdir()
    backup_file_path = os.path.join(
        temp_dir, f"kint_backup_{datetime.now(tz=UTC).strftime('%Y%m%d%H%M%S')}.db"
    )
    conn = await session.connection()
    raw_conn = await conn.get_raw_connection()

    target_conn = None
    candidates = [raw_conn]
    for attr in ["dbapi_connection", "_connection"]:
        val = getattr(raw_conn, attr, None)
        if val is not None:
            candidates.append(val)

    for c in candidates:
        if hasattr(c, "backup") and inspect.iscoroutinefunction(c.backup):
            target_conn = c
            break

    if target_conn is not None:
        with sqlite3.connect(backup_file_path) as dest:
            await target_conn.backup(dest)
    else:
        real_conn = raw_conn
        for attr in ["_connection", "dbapi_connection", "_conn", "connection"]:
            val = getattr(real_conn, attr, None)
            if val is not None:
                real_conn = val
        if hasattr(real_conn, "backup"):
            with sqlite3.connect(backup_file_path) as dest:
                real_conn.backup(dest)
        else:
            raise HTTPException(
                status_code=500, detail="バックアップを実行できる SQLite 接続が見つかりませんでした"
            )

    filename = f"kint-backup-{datetime.now(tz=UTC).strftime('%Y%m%d%H%M%S')}.db"
    background_tasks.add_task(
        lambda: os.remove(backup_file_path) if os.path.exists(backup_file_path) else None
    )

    return FileResponse(
        path=backup_file_path,
        filename=filename,
        media_type="application/x-sqlite3",
        background=background_tasks,
    )


@router.post("/database/restore")
async def restore_database_api(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """アップロードされたバックアップファイルでデータベースを復元する。"""
    _require_admin(current_user)

    temp_dir = tempfile.gettempdir()
    temp_file_path = os.path.join(
        temp_dir, f"kint_restore_{datetime.now(tz=UTC).strftime('%Y%m%d%H%M%S')}.db"
    )

    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        async with aiosqlite.connect(temp_file_path) as src:
            async with src.execute("PRAGMA integrity_check") as cursor:
                res = await cursor.fetchone()
                if not res or res[0] != "ok":
                    raise ValueError("データベースファイルの整合性チェックに失敗しました")

            async with src.execute("SELECT name FROM sqlite_master WHERE type='table'") as cursor:
                tables = {r[0] for r in await cursor.fetchall()}
                required_tables = {"users", "attendances", "cards"}
                if not required_tables.issubset(tables):
                    raise ValueError("有効なkintデータベースファイルではありません")

            conn = await session.connection()
            raw_conn = await conn.get_raw_connection()

            dest_conn = None
            candidates = [raw_conn]
            for attr in ["dbapi_connection", "_connection"]:
                val = getattr(raw_conn, attr, None)
                if val is not None:
                    candidates.append(val)

            async_conn = None
            for c in candidates:
                if hasattr(c, "backup") and inspect.iscoroutinefunction(c.backup):
                    async_conn = c
                    break

            if async_conn is not None:
                dest_sqlite_conn = getattr(async_conn, "_conn", None)
                if dest_sqlite_conn is not None:
                    await src.backup(dest_sqlite_conn)
                else:
                    raise ValueError("復元先の生の SQLite 接続が見つかりませんでした")
            else:
                real_conn = raw_conn
                for attr in ["_connection", "dbapi_connection", "_conn", "connection"]:
                    val = getattr(real_conn, attr, None)
                    if val is not None:
                        real_conn = val
                if hasattr(real_conn, "backup"):
                    with sqlite3.connect(temp_file_path) as src_sync:
                        src_sync.backup(real_conn)
                else:
                    raise ValueError("復元を実行できる SQLite 接続が見つかりませんでした")

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"復元処理中にエラーが発生しました: {str(e)}"
        )
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    return {"message": "データベースを正常に復元しました"}
