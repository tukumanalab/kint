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
    MeProfileUpdateRequest,
    PasswordChangeRequest,
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


@router.patch("/password", status_code=204)
async def change_password(
    body: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    """パスワードを変更する。成功時は 204 を返しセッションを無効化する。"""
    service = UserService(session)
    await service.change_password(current_user, body.current_password, body.new_password)
    return Response(status_code=204)
