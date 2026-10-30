"""メール送信アダプター。Resend の HTTP API で確認メール・通知メールを送信する。"""

from __future__ import annotations

import logging

import httpx

from kint.config import settings
from kint.exceptions import KintBadGatewayError

logger = logging.getLogger(__name__)

_RESEND_API_URL = "https://api.resend.com/emails"
_TIMEOUT_SECONDS = 10.0


def _build_verification_email(token: str, verification_type: str) -> tuple[str, str]:
    """確認メールの件名と本文を生成する。"""
    confirm_url = f"{settings.app_base_url}/email-verifications/confirm?token={token}"

    if verification_type == "signup":
        subject = "【Kint】メールアドレスの確認"
        body_text = (
            f"Kint にご登録いただきありがとうございます。\n\n"
            f"以下のリンクをクリックしてメールアドレスを確認してください。\n\n"
            f"{confirm_url}\n\n"
            f"このリンクの有効期限は {settings.email_verification_expire_hours} 時間です。\n\n"
            f"心当たりがない場合はこのメールを無視してください。"
        )
    else:
        subject = "【Kint】メールアドレス変更の確認"
        body_text = (
            f"Kint のメールアドレス変更リクエストを受け付けました。\n\n"
            f"以下のリンクをクリックして変更を確定してください。\n\n"
            f"{confirm_url}\n\n"
            f"このリンクの有効期限は {settings.email_verification_expire_hours} 時間です。\n\n"
            f"心当たりがない場合はこのメールを無視してください。"
        )
    return subject, body_text


def _resend_error_detail(response: httpx.Response) -> str:
    """Resend のエラーレスポンスからログ用の説明を取り出す。"""
    try:
        data = response.json()
    except ValueError:
        return response.text[:200]
    if isinstance(data, dict):
        return f"{data.get('name', '')}: {data.get('message', '')}"
    return str(data)[:200]


class MailAdapter:
    """Resend を使ってメールを送信するアダプター。"""

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def send_email(
        self,
        to: str,
        subject: str,
        body_text: str,
        sender_name: str | None = None,
    ) -> None:
        """任意のメールを送信する。送信失敗時は KintBadGatewayError を発生させる。

        差出人は「sender_name（未指定時は SITE_NAME） <MAIL_FROM>」、
        返信先は MAIL_REPLY_TO（未設定時は MAIL_FROM）。
        """
        api_key = settings.resend_api_key
        mail_from = settings.mail_from
        if not api_key or not mail_from:
            logger.error(
                "Resend の設定が不足しています: RESEND_API_KEY=%s MAIL_FROM=%s",
                "Set" if api_key else "NOT SET",
                "Set" if mail_from else "NOT SET",
            )
            raise KintBadGatewayError(
                code="MAIL_NOT_CONFIGURED",
                message="メール送信 (Resend) の設定がされていません",
            )

        payload = {
            "from": f"{sender_name or settings.site_name} <{mail_from}>",
            "reply_to": settings.mail_reply_to or mail_from,
            "to": [to],
            "subject": subject,
            "text": body_text,
        }
        logger.debug("メール送信を開始します: to=%s subject=%s", to, subject)
        try:
            with httpx.Client(timeout=_TIMEOUT_SECONDS, transport=self._transport) as client:
                response = client.post(
                    _RESEND_API_URL,
                    json=payload,
                    headers={"Authorization": f"Bearer {api_key}"},
                )
        except httpx.HTTPError as e:
            logger.error("Resend 通信エラー: to=%s subject=%s error=%s", to, subject, e)
            raise KintBadGatewayError(
                code="MAIL_SEND_FAILED",
                message="メールの送信に失敗しました",
            ) from e

        if response.is_error:
            logger.error(
                "Resend 送信エラー: to=%s subject=%s status=%s error=%s",
                to,
                subject,
                response.status_code,
                _resend_error_detail(response),
            )
            raise KintBadGatewayError(
                code="MAIL_SEND_FAILED",
                message="メールの送信に失敗しました",
            )
        logger.info("メールを送信しました: to=%s subject=%s", to, subject)

    def send_email_verification(
        self,
        to: str,
        token: str,
        verification_type: str,
        sender_name: str | None = None,
    ) -> None:
        """確認メールを送信する。送信失敗時は KintBadGatewayError を発生させる。"""
        subject, body_text = _build_verification_email(token, verification_type)
        self.send_email(to, subject, body_text, sender_name=sender_name)
