"""ユーザー管理ルーター。管理者専用の CRUD エンドポイントを提供する。"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.dependencies import get_current_user
from kint.exceptions import KintForbiddenError
from kint.models.user import User
from kint.schemas.user import UserCreateRequest, UserPatchRequest, UserResponse
from kint.services.user import UserService

router = APIRouter(prefix="/users", tags=["Users"])


def _require_admin(current_user: User) -> None:
    """管理者以外のアクセスを拒否する。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="管理者権限が必要です",
        )


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    body: UserCreateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UserResponse:
    """ユーザーを新規作成する。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    return await service.create_user(body)


@router.patch("/{user_id}", response_model=UserResponse)
async def patch_user(
    user_id: str,
    body: UserPatchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UserResponse:
    """ユーザー情報を更新する。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    return await service.patch_user(user_id, body)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """ユーザーを論理削除する。管理者専用。既に無効な場合も 204 を返す。"""
    _require_admin(current_user)
    service = UserService(session)
    await service.delete_user(user_id)
    return Response(status_code=204)
