"""FastAPI アプリケーションエントリーポイント。"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from kint.exceptions import (
    KintConflictError,
    KintForbiddenError,
    KintNotFoundError,
    KintUnauthorizedError,
)
from kint.routers import attendance, punch, user
from kint.schemas.error import ErrorResponse

app = FastAPI(
    title="Kint Attendance API",
    version="1.0.0",
    description="Kint NFC勤怠管理システムの API",
)

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


# ------------------------------------------------------------------
# ルーター登録
# ------------------------------------------------------------------

app.include_router(punch.router, prefix="/api/v1")
app.include_router(attendance.router, prefix="/api/v1")
app.include_router(user.router, prefix="/api/v1")
