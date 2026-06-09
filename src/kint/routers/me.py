"""マイページ API ルーター。本人プロフィール編集エンドポイントを提供する。"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.dependencies import get_current_user
from kint.models.user import User
from kint.schemas.auth import UserProfile
from kint.schemas.user import (
    EmailChangeAcceptedResponse,
    EmailChangeRequestCreate,
    MeCardListItem,
    MeCardPatchRequest,
    MeCardRegistrationRequest,
    MeCardRegistrationResponse,
    MeProfileUpdateRequest,
)
from kint.services.gmail import GmailAdapter
from kint.services.user import UserService

router = APIRouter(prefix="/me", tags=["User"])


@router.get("", response_model=UserProfile)
async def get_me(current_user: User = Depends(get_current_user)) -> UserProfile:
    """現在のログインユーザーのプロフィールを返す。"""
    return UserProfile.model_validate(current_user)


@router.patch("/profile", response_model=UserProfile)
async def update_profile(
    body: MeProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UserProfile:
    """本人の name / full_name を更新する。"""
    service = UserService(session)
    updated = await service.update_my_profile(current_user, body)
    return UserProfile.model_validate(updated)


@router.post("/email-change-requests", response_model=EmailChangeAcceptedResponse, status_code=202)
async def request_email_change(
    body: EmailChangeRequestCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EmailChangeAcceptedResponse:
    """新メールアドレス宛に確認メールを送信する。承認前は email は変更しない。"""
    service = UserService(session)
    gmail = GmailAdapter()
    return await service.request_email_change(current_user, body, gmail)





@router.get("/cards", response_model=list[MeCardListItem])
async def get_my_cards(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> list[MeCardListItem]:
    """本人に紐付く NFC カード一覧を返す。"""
    service = UserService(session)
    return await service.get_my_cards(current_user)


@router.patch("/cards/{card_id}", response_model=MeCardListItem)
async def rename_my_card(
    card_id: str,
    body: MeCardPatchRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MeCardListItem:
    """本人の NFC カード名を変更する。"""
    service = UserService(session)
    return await service.rename_my_card(current_user, card_id, body)


@router.delete("/cards/{card_id}", status_code=204)
async def delete_my_card(
    card_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """本人の NFC カードを削除する。"""
    service = UserService(session)
    await service.delete_my_card(current_user, card_id)
    return Response(status_code=204)


@router.post("/cards", response_model=MeCardRegistrationResponse, status_code=201)
async def register_my_card(
    body: MeCardRegistrationRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> MeCardRegistrationResponse:
    """本人の NFC カード (card_idm) を登録する。"""
    service = UserService(session)
    return await service.register_my_card(current_user, body)
