"""ユーザー管理ルーター。管理者専用の CRUD エンドポイントを提供する。"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.dependencies import get_current_user
from kint.exceptions import KintForbiddenError
from kint.models.user import User
from kint.schemas.face import FaceDescriptorIn, FaceIdentifyRequest, FaceStatus, FaceVerifyResponse
from kint.schemas.user import (
    MeCardListItem,
    MeCardPatchRequest,
    MeCardRegistrationRequest,
    MeCardRegistrationResponse,
    UserCreateRequest,
    UserPatchRequest,
    UserResponse,
    UsersListResponse,
)
from kint.schemas.user_backup import ImportResultSchema, UserBackupSchema
from kint.services.face import FaceService
from kint.services.user import UserService

router = APIRouter(prefix="/users", tags=["Users"])


def _require_admin(current_user: User) -> None:
    """管理者以外のアクセスを拒否する。"""
    if current_user.role != "admin":
        raise KintForbiddenError(
            code="FORBIDDEN",
            message="管理者権限が必要です",
        )


@router.get("", response_model=UsersListResponse)
async def list_users(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UsersListResponse:
    """ユーザー一覧を返す。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    return await service.list_users()


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
    hard: bool = False,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """ユーザーを論理削除または物理（完全）削除する。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    if hard:
        await service.hard_delete_user(user_id)
    else:
        await service.delete_user(user_id)
    return Response(status_code=204)


@router.get("/export", response_model=list[UserBackupSchema])
async def export_users(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[UserBackupSchema]:
    """登録ユーザーとカード情報を一括エクスポートする。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    return await service.export_users()


@router.post("/import", response_model=ImportResultSchema)
async def import_users(
    body: list[UserBackupSchema],
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> ImportResultSchema:
    """登録ユーザーとカード情報を一括インポート（復元）する。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    res = await service.import_users(body)
    return ImportResultSchema(**res)


@router.get("/{user_id}/cards", response_model=list[MeCardListItem])
async def list_user_cards(
    user_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[MeCardListItem]:
    """対象ユーザーのNFCカード一覧を返す。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    return await service.get_user_cards(user_id)


@router.post("/{user_id}/cards", response_model=MeCardRegistrationResponse, status_code=201)
async def register_user_card(
    user_id: str,
    body: MeCardRegistrationRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MeCardRegistrationResponse:
    """対象ユーザーにNFCカードを登録する。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    return await service.register_user_card(user_id, body)


@router.patch("/{user_id}/cards/{card_id}", response_model=MeCardListItem)
async def rename_user_card(
    user_id: str,
    card_id: str,
    body: MeCardPatchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MeCardListItem:
    """対象ユーザーのNFCカード名を変更する。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    return await service.rename_user_card(user_id, card_id, body)


@router.delete("/{user_id}/cards/{card_id}", status_code=204)
async def delete_user_card(
    user_id: str,
    card_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """対象ユーザーのNFCカードを削除する。管理者専用。"""
    _require_admin(current_user)
    service = UserService(session)
    await service.delete_user_card(user_id, card_id)
    return Response(status_code=204)


@router.get("/{user_id}/face", response_model=FaceStatus)
async def get_user_face(
    user_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FaceStatus:
    """対象ユーザーの顔データ登録状況を返す。管理者専用。"""
    _require_admin(current_user)
    service = FaceService(session)
    return await service.get_status(user_id)


@router.put("/{user_id}/face", response_model=FaceStatus)
async def put_user_face(
    user_id: str,
    body: FaceDescriptorIn,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FaceStatus:
    """対象ユーザーの顔データを登録（既存を置換）する。管理者専用。対象が管理者ユーザーの場合は不可。"""
    _require_admin(current_user)
    service = FaceService(session)
    return await service.register_descriptors(user_id, body.descriptors)


@router.post("/{user_id}/face/verify", response_model=FaceVerifyResponse)
async def verify_user_face(
    user_id: str,
    body: FaceIdentifyRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> FaceVerifyResponse:
    """対象ユーザーの顔データで照合テストを行う。管理者専用。"""
    _require_admin(current_user)
    service = FaceService(session)
    return await service.verify_user(user_id, body.descriptor, datetime.now(tz=UTC))


@router.delete("/{user_id}/face", status_code=204)
async def delete_user_face(
    user_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """対象ユーザーの顔データを削除する。管理者専用。"""
    _require_admin(current_user)
    service = FaceService(session)
    await service.delete_descriptors(user_id)
    return Response(status_code=204)
