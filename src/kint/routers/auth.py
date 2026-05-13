"""認証ルーター。POST /api/v1/auth/login および GET /api/v1/auth/me を提供する。"""

import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
from fastapi import APIRouter, Depends
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.config import settings
from kint.db import get_db
from kint.dependencies import get_current_user
from kint.exceptions import KintConflictError, KintUnauthorizedError
from kint.models.user import User
from kint.schemas.auth import (
    GoogleLoginRequest,
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    UserProfile,
)

router = APIRouter(prefix="/auth", tags=["Auth"])

_ALGORITHM = "HS256"
_TOKEN_EXPIRE_HOURS = 8


def _create_access_token(user_id: str, token_version: int) -> str:
    """JWT アクセストークンを生成する。tv クレームでトークンバージョンを埋め込む。"""
    expire = datetime.now(tz=UTC) + timedelta(hours=_TOKEN_EXPIRE_HOURS)
    payload = {"sub": user_id, "tv": token_version, "exp": expire}
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

    token = _create_access_token(user.id, user.token_version or 1)
    return LoginResponse(
        access_token=token,
        token_type="bearer",
        user=UserProfile.model_validate(user),
    )


@router.get("/me", response_model=UserProfile)
async def me(current_user: User = Depends(get_current_user)) -> UserProfile:
    """現在のログインユーザー情報を返す。"""
    return UserProfile.model_validate(current_user)


def _verify_google_id_token(id_token: str) -> dict:
    """Google ID Token を検証して claims を返す。無効な場合は KintUnauthorizedError。

    GOOGLE_CLIENT_ID が未設定の場合は audience 検証をスキップする（開発用途）。
    本番環境では必ず GOOGLE_CLIENT_ID を設定すること。
    """
    try:
        return google_id_token.verify_oauth2_token(
            id_token,
            google_requests.Request(),
            audience=settings.google_client_id or None,
        )
    except Exception as e:
        raise KintUnauthorizedError(
            code="INVALID_GOOGLE_TOKEN",
            message="Google IDトークンが無効です",
        ) from e


@router.post("/google", response_model=LoginResponse)
async def google_login(
    body: GoogleLoginRequest,
    session: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """Google ID Token を検証し、対応するユーザーの Kint JWT を返す。"""
    claims = _verify_google_id_token(body.id_token)
    sub: str = claims["sub"]
    email: str = claims.get("email", "")

    # google_sub で既存ユーザーを検索（2回目以降ログイン）
    result = await session.execute(select(User).where(User.google_sub == sub, User.is_active == 1))
    user = result.scalar_one_or_none()

    if user is None:
        # メールアドレスで初回ログインのユーザーを検索
        result = await session.execute(select(User).where(User.email == email, User.is_active == 1))
        user = result.scalar_one_or_none()

        if user is None:
            raise KintUnauthorizedError(
                code="USER_NOT_REGISTERED",
                message="このGoogleアカウントは登録されていません",
            )

        # 初回ログイン: google_sub を紐付けて保存
        user.google_sub = sub
        await session.commit()
        await session.refresh(user)

    if user.is_active == 0:
        raise KintUnauthorizedError(
            code="USER_INACTIVE",
            message="アカウントが無効化されています",
        )

    token = _create_access_token(user.id, user.token_version or 1)
    return LoginResponse(
        access_token=token,
        token_type="bearer",
        user=UserProfile.model_validate(user),
    )


@router.post("/register", response_model=LoginResponse, status_code=201)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """新規ユーザーを Google アカウントで登録し、Kint JWT を返す。"""
    claims = _verify_google_id_token(body.id_token)
    sub: str = claims["sub"]
    email: str = claims.get("email", "")

    # 登録済みチェック
    result = await session.execute(
        select(User).where((User.google_sub == sub) | (User.email == email))
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        raise KintConflictError(
            code="USER_ALREADY_EXISTS",
            message="このGoogleアカウントはすでに登録済みです",
        )

    is_admin = (
        bool(body.admin_password)
        and bool(settings.admin_password)
        and body.admin_password == settings.admin_password
    )
    display_name = claims.get("name") or email.split("@")[0]
    user = User(
        id=uuid.uuid4().hex[:16],
        name=display_name,
        full_name=display_name,
        email=email,
        password_hash=None,
        google_sub=sub,
        role="admin" if is_admin else "employee",
        is_active=1,
        token_version=1,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    token = _create_access_token(user.id, user.token_version)
    return LoginResponse(
        access_token=token,
        token_type="bearer",
        user=UserProfile.model_validate(user),
    )
