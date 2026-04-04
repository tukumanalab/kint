"""FastAPI 依存関数。DB セッションおよび認証ユーザー取得に使用する。"""

from fastapi import Depends, Header
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.config import settings
from kint.db import get_db
from kint.exceptions import KintUnauthorizedError
from kint.models.user import User

_ALGORITHM = "HS256"


async def get_current_user(
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_db),
) -> User:
    """Bearer トークンからログインユーザーを返す。未認証なら KintUnauthorizedError。"""
    if authorization is None or not authorization.startswith("Bearer "):
        raise KintUnauthorizedError(code="UNAUTHORIZED", message="認証が必要です")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise KintUnauthorizedError(code="INVALID_TOKEN", message="トークンが無効です")
    except JWTError:
        raise KintUnauthorizedError(code="INVALID_TOKEN", message="トークンが無効です")

    result = await session.execute(select(User).where(User.id == user_id, User.is_active == 1))
    user = result.scalar_one_or_none()
    if user is None:
        raise KintUnauthorizedError(code="USER_NOT_FOUND", message="ユーザーが見つかりません")

    return user
