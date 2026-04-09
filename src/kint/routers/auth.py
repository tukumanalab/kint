"""認証ルーター。POST /api/v1/auth/login および GET /api/v1/auth/me を提供する。"""

from datetime import UTC, datetime, timedelta

import bcrypt
from fastapi import APIRouter, Depends
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.config import settings
from kint.db import get_db
from kint.dependencies import get_current_user
from kint.exceptions import KintUnauthorizedError
from kint.models.user import User
from kint.schemas.auth import LoginRequest, LoginResponse, UserProfile

router = APIRouter(prefix="/auth", tags=["Auth"])

_ALGORITHM = "HS256"
_TOKEN_EXPIRE_HOURS = 8


def _create_access_token(user_id: str) -> str:
    """JWT アクセストークンを生成する。"""
    expire = datetime.now(tz=UTC) + timedelta(hours=_TOKEN_EXPIRE_HOURS)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """アカウントIDとパスワードで認証し、JWT トークンを返す。"""
    result = await session.execute(
        select(User).where(User.id == body.account_id, User.is_active == 1)
    )
    user = result.scalar_one_or_none()

    if user is None or not bcrypt.checkpw(body.password.encode(), user.password_hash.encode()):
        raise KintUnauthorizedError(
            code="INVALID_CREDENTIALS",
            message="アカウントIDまたはパスワードが正しくありません",
        )

    token = _create_access_token(user.id)
    return LoginResponse(
        access_token=token,
        token_type="bearer",
        user=UserProfile.model_validate(user),
    )


@router.get("/me", response_model=UserProfile)
async def me(current_user: User = Depends(get_current_user)) -> UserProfile:
    """現在のログインユーザー情報を返す。"""
    return UserProfile.model_validate(current_user)
