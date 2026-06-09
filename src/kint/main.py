"""FastAPI アプリケーションエントリーポイント。"""

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Form, Request
from fastapi.exceptions import HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from kint.config import settings as _app_settings
from kint.db import AsyncSessionLocal
from kint.exceptions import (
    KintBadGatewayError,
    KintBadRequestError,
    KintConflictError,
    KintForbiddenError,
    KintNotFoundError,
    KintUnauthorizedError,
)
from kint.logging_setup import setup_logging
from kint.models.user import User
from kint.routers import (
    attendance,
    auth,
    email_verification,
    logs,
    me,
    punch,
    settings,
    shifts,
    user,
)
from kint.scheduler import init_scheduler, scheduler
from kint.schemas.error import ErrorResponse

setup_logging(log_level="DEBUG" if _app_settings.debug else "INFO")

app = FastAPI(
    title="Kint Attendance API",
    version="1.0.0",
    description="Kint NFC勤怠管理システムの API",
)

_DEFAULT_ADMIN_ID = "manager"
_DEFAULT_ADMIN_EMAIL = "manager+bootstrap@kint.local"


@app.on_event("startup")
async def start_scheduler() -> None:
    """起動時にスケジューラを初期化する。"""
    await init_scheduler()


@app.on_event("shutdown")
async def stop_scheduler() -> None:
    """停止時にスケジューラをシャットダウンする。"""
    if scheduler.running:
        scheduler.shutdown()


@app.on_event("startup")
async def ensure_default_admin_user() -> None:
    """起動時に既定の管理者ユーザーおよびシステムユーザーを未作成時のみ作成する。"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == _DEFAULT_ADMIN_ID))
        admin_user = result.scalar_one_or_none()

        if admin_user is None:
            admin_user = User(
                id=_DEFAULT_ADMIN_ID,
                name="manager",
                full_name="Manager",
                email=_DEFAULT_ADMIN_EMAIL,
                role="admin",
                is_active=1,
            )
            session.add(admin_user)

        result_system = await session.execute(select(User).where(User.id == "system"))
        system_user = result_system.scalar_one_or_none()

        if system_user is None:
            system_user = User(
                id="system",
                name="system",
                full_name="System Automatic Processor",
                email="system@kint.local",
                role="admin",
                is_active=1,
            )
            session.add(system_user)

        await session.commit()


# ------------------------------------------------------------------
# BE-05: エラーレスポンス統一ハンドラー
# ------------------------------------------------------------------


@app.exception_handler(KintNotFoundError)
async def not_found_handler(request: Request, exc: KintNotFoundError) -> JSONResponse:
    """404 NotFound を ErrorResponse 形式で返す。"""
    return JSONResponse(
        status_code=404,
        content=ErrorResponse(code=exc.code, message=exc.message, detail=exc.detail).model_dump(
            exclude_none=True
        ),
    )


@app.exception_handler(KintConflictError)
async def conflict_handler(request: Request, exc: KintConflictError) -> JSONResponse:
    """409 Conflict を ErrorResponse 形式で返す。"""
    return JSONResponse(
        status_code=409,
        content=ErrorResponse(code=exc.code, message=exc.message, detail=exc.detail).model_dump(
            exclude_none=True
        ),
    )


@app.exception_handler(KintForbiddenError)
async def forbidden_handler(request: Request, exc: KintForbiddenError) -> JSONResponse:
    """403 Forbidden を ErrorResponse 形式で返す。"""
    return JSONResponse(
        status_code=403,
        content=ErrorResponse(code=exc.code, message=exc.message, detail=exc.detail).model_dump(
            exclude_none=True
        ),
    )


@app.exception_handler(KintUnauthorizedError)
async def unauthorized_handler(request: Request, exc: KintUnauthorizedError) -> JSONResponse:
    """401 Unauthorized を ErrorResponse 形式で返す。"""
    return JSONResponse(
        status_code=401,
        content=ErrorResponse(code=exc.code, message=exc.message, detail=exc.detail).model_dump(
            exclude_none=True
        ),
    )


@app.exception_handler(KintBadRequestError)
async def bad_request_handler(request: Request, exc: KintBadRequestError) -> JSONResponse:
    """400 BadRequest を ErrorResponse 形式で返す。"""
    return JSONResponse(
        status_code=400,
        content=ErrorResponse(code=exc.code, message=exc.message, detail=exc.detail).model_dump(
            exclude_none=True
        ),
    )


@app.exception_handler(KintBadGatewayError)
async def bad_gateway_handler(request: Request, exc: KintBadGatewayError) -> JSONResponse:
    """502 BadGateway を ErrorResponse 形式で返す。"""
    return JSONResponse(
        status_code=502,
        content=ErrorResponse(code=exc.code, message=exc.message, detail=exc.detail).model_dump(
            exclude_none=True
        ),
    )


# ------------------------------------------------------------------
# ルーター登録
# ------------------------------------------------------------------

app.include_router(auth.router, prefix="/api/v1")
app.include_router(punch.router, prefix="/api/v1")
app.include_router(attendance.router, prefix="/api/v1")
app.include_router(user.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
app.include_router(email_verification.router, prefix="/api/v1")
app.include_router(settings.router, prefix="/api/v1")
app.include_router(shifts.router, prefix="/api/v1")
app.include_router(logs.router, prefix="/api/v1")


# ------------------------------------------------------------------
# ヘルスチェック
# ------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    """Docker ヘルスチェック用エンドポイント。"""
    return {"status": "ok"}


# ------------------------------------------------------------------
# Google OAuth2 redirect モード コールバック（本番用）
# Google Identity Services が form_post で credential を POST してくる。
# credential を sessionStorage に保存して SPA ルートへリダイレクトする。
# ------------------------------------------------------------------


@app.post("/")
async def google_oauth_callback(credential: str = Form(...)) -> HTMLResponse:
    """Google OAuth2 redirect モードのコールバック。form_post で受け取った credential を
    sessionStorage に保存して SPA ルートへリダイレクトする。
    """
    safe_credential = json.dumps(credential)
    html = (
        '<!DOCTYPE html><html><head><meta charset="utf-8"><script>\n'
        f"sessionStorage.setItem('google_credential',{safe_credential});\n"
        "window.location.href='/';\n"
        "<\\/script></head><body>Redirecting...</body></html>"
    )
    return HTMLResponse(content=html)


# ------------------------------------------------------------------
# フロントエンド SPA 静的配信（本番のみ）
# ビルド成果物が存在する場合のみマウントする。
# 開発環境では Vite dev サーバーが代わりに配信するため不要。
# ------------------------------------------------------------------

_STATIC_DIR = Path(__file__).parent / "static"


class _SPAStaticFiles(StaticFiles):
    """SPA 用 StaticFiles。404 時に index.html へフォールバックする。"""

    async def get_response(self, path: str, scope: Any) -> Any:
        """パスに対応するファイルが存在しない場合は index.html を返す。"""
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


if _STATIC_DIR.is_dir():
    app.mount("/", _SPAStaticFiles(directory=_STATIC_DIR, html=True), name="spa")
