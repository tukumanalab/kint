"""FastAPI アプリケーションエントリーポイント。"""

import bcrypt
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from kint.db import AsyncSessionLocal
from kint.exceptions import (
    KintBadGatewayError,
    KintBadRequestError,
    KintConflictError,
    KintForbiddenError,
    KintNotFoundError,
    KintUnauthorizedError,
)
from kint.models.user import User
from kint.routers import attendance, auth, email_verification, me, punch, user
from kint.schemas.error import ErrorResponse

app = FastAPI(
    title="Kint Attendance API",
    version="1.0.0",
    description="Kint NFC勤怠管理システムの API",
)

_DEFAULT_ADMIN_ID = "manager"
_DEFAULT_ADMIN_PASSWORD = "manager123"
_DEFAULT_ADMIN_EMAIL = "manager+bootstrap@kint.local"


def _hash_password(plain: str) -> str:
    """bcrypt でパスワードをハッシュ化する。"""
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


@app.on_event("startup")
async def ensure_default_admin_user() -> None:
    """起動時に既定の管理者ユーザーを未作成時のみ作成する。"""
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == _DEFAULT_ADMIN_ID))
        admin_user = result.scalar_one_or_none()

        if admin_user is None:
            admin_user = User(
                id=_DEFAULT_ADMIN_ID,
                name="manager",
                full_name="Manager",
                email=_DEFAULT_ADMIN_EMAIL,
                password_hash=_hash_password(_DEFAULT_ADMIN_PASSWORD),
                role="admin",
                is_active=1,
            )
            session.add(admin_user)

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
