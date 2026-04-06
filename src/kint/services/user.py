"""ユーザー管理サービス。"""

import uuid

import bcrypt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.exceptions import KintConflictError, KintNotFoundError
from kint.models.user import User
from kint.schemas.user import UserCreateRequest, UserPatchRequest, UserResponse

_MIN_ACTIVE_ADMINS = 1


def _hash_password(plain: str) -> str:
    """bcrypt でパスワードをハッシュ化する。"""
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


async def _count_active_admins(session: AsyncSession, exclude_user_id: str | None = None) -> int:
    """有効な admin の件数を返す。exclude_user_id を指定するとその1件を除外する。"""
    query = select(func.count()).where(User.role == "admin", User.is_active == 1)
    if exclude_user_id is not None:
        query = query.where(User.id != exclude_user_id)
    result = await session.execute(query)
    return result.scalar_one()


class UserService:
    """ユーザー管理サービス。登録・修正・論理削除を処理する。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_user(self, data: UserCreateRequest) -> UserResponse:
        """ユーザーを新規作成する。メール重複時は KintConflictError。"""
        existing = await self.session.execute(select(User.id).where(User.email == data.email))
        if existing.scalar_one_or_none() is not None:
            raise KintConflictError(
                code="EMAIL_CONFLICT",
                message=f"メールアドレス '{data.email}' はすでに使用されています",
                detail={"email": data.email},
            )

        user = User(
            id=str(uuid.uuid4()),
            name=data.name,
            full_name=data.full_name,
            email=data.email,
            password_hash=_hash_password(data.password),
            role=data.role,
            is_active=1,
        )
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)
        return UserResponse.model_validate(user)

    async def patch_user(self, user_id: str, data: UserPatchRequest) -> UserResponse:
        """ユーザー情報を更新する。メール重複・最後のadmin無効化は KintConflictError。"""
        result = await self.session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise KintNotFoundError(
                code="USER_NOT_FOUND",
                message=f"ユーザー '{user_id}' が見つかりません",
            )

        # email 重複チェック
        if data.email is not None and data.email != user.email:
            dup = await self.session.execute(
                select(User.id).where(User.email == data.email, User.id != user_id)
            )
            if dup.scalar_one_or_none() is not None:
                raise KintConflictError(
                    code="EMAIL_CONFLICT",
                    message=f"メールアドレス '{data.email}' はすでに使用されています",
                    detail={"email": data.email},
                )

        # 最後の有効な admin を無効化しようとした場合はエラー
        deactivating = data.is_active is False and user.is_active == 1
        demoting = data.role is not None and data.role != "admin" and user.role == "admin"
        if (deactivating or demoting) and user.role == "admin":
            remaining = await _count_active_admins(self.session, exclude_user_id=user_id)
            if remaining < _MIN_ACTIVE_ADMINS:
                raise KintConflictError(
                    code="LAST_ADMIN",
                    message="最後の有効な管理者を無効化またはロール変更することはできません",
                )

        if data.name is not None:
            user.name = data.name
        if data.full_name is not None:
            user.full_name = data.full_name
        if data.email is not None:
            user.email = data.email
        if data.role is not None:
            user.role = data.role
        if data.is_active is not None:
            user.is_active = 1 if data.is_active else 0

        await self.session.commit()
        await self.session.refresh(user)
        return UserResponse.model_validate(user)

    async def delete_user(self, user_id: str) -> bool:
        """ユーザーを論理削除する。既に無効なら冪等に True を返す。
        最後の有効な admin の削除は KintConflictError。
        存在しないユーザーは KintNotFoundError。
        戻り値は「既に無効だったか否か」にかかわらず True（204 用）。"""
        result = await self.session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise KintNotFoundError(
                code="USER_NOT_FOUND",
                message=f"ユーザー '{user_id}' が見つかりません",
            )

        # 既に無効 → 冪等
        if user.is_active == 0:
            return True

        # 最後の有効な admin は削除不可
        if user.role == "admin":
            remaining = await _count_active_admins(self.session, exclude_user_id=user_id)
            if remaining < _MIN_ACTIVE_ADMINS:
                raise KintConflictError(
                    code="LAST_ADMIN",
                    message="最後の有効な管理者を削除することはできません",
                )

        user.is_active = 0
        await self.session.commit()
        return True
