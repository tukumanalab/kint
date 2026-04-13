"""メール確認ルーター。POST /email-verifications/confirm エンドポイントを提供する。"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from kint.db import get_db
from kint.schemas.user import EmailVerificationConfirmRequest, EmailVerificationConfirmResponse
from kint.services.user import UserService

router = APIRouter(prefix="/email-verifications", tags=["User"])


@router.post("/confirm", response_model=EmailVerificationConfirmResponse)
async def confirm_email_verification(
    body: EmailVerificationConfirmRequest,
    session: AsyncSession = Depends(get_db),
) -> EmailVerificationConfirmResponse:
    """確認トークンを検証してメールアドレスを確定する。認証不要（公開エンドポイント）。"""
    service = UserService(session)
    return await service.confirm_email_verification(body.token)
