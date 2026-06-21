"""Gmail API アダプター。OAuth 2.0 クライアント認証で確認メールを送信する。"""

from __future__ import annotations

import base64
import logging
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from google.auth.exceptions import TransportError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from kint.config import settings
from kint.exceptions import KintBadGatewayError

logger = logging.getLogger(__name__)

_TOKEN_URI = "https://oauth2.googleapis.com/token"
_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send"


def _load_credentials() -> Credentials:
    """認証情報を取得する。

    優先順位:
    1. 直接指定方式: GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
    2. ファイル方式: GMAIL_OAUTH_CREDENTIALS_FILE / GMAIL_TOKEN_FILE（フォールバック）
    """
    # --- 1. 直接指定方式 ---
    if settings.gmail_client_id and settings.gmail_client_secret and settings.gmail_refresh_token:
        logger.debug("Gmail 認証: リフレッシュトークン直接指定方式を使用します")
        creds = Credentials(
            token=None,
            refresh_token=settings.gmail_refresh_token,
            token_uri=_TOKEN_URI,
            client_id=settings.gmail_client_id,
            client_secret=settings.gmail_client_secret,
        )
        try:
            creds.refresh(Request())
        except Exception as e:
            logger.error("Gmail トークン取得に失敗しました: %s", e)
            raise KintBadGatewayError(
                code="GMAIL_TOKEN_REFRESH_FAILED",
                message="Gmail API トークンの取得に失敗しました",
            ) from e
        logger.debug("Gmail アクセストークンを取得しました")
        return creds

    # --- 2. ファイル方式（フォールバック） ---
    logger.debug("Gmail 認証: トークンファイル方式を使用します")
    creds: Credentials | None = None
    token_file = settings.gmail_token_file

    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, [_GMAIL_SCOPE])
        logger.debug("Gmail トークンファイルを読み込みました: %s", token_file)
    else:
        logger.debug("Gmail トークンファイルが存在しません: %s", token_file)

    if creds and creds.valid:
        logger.debug("Gmail 認証情報は有効です")
        return creds

    if creds and creds.expired and creds.refresh_token:
        logger.info("Gmail アクセストークンを更新します")
        try:
            creds.refresh(Request())
        except Exception as e:
            logger.error("Gmail トークン更新に失敗しました: %s", e)
            raise KintBadGatewayError(
                code="GMAIL_TOKEN_REFRESH_FAILED",
                message="Gmail API トークンの更新に失敗しました",
            ) from e
        _save_credentials(creds)
        logger.info("Gmail アクセストークンを更新しました")
        return creds

    if not settings.gmail_oauth_credentials_file:
        logger.error(
            "Gmail API 認証情報が未設定です。"
            "GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN または "
            "GMAIL_OAUTH_CREDENTIALS_FILE を設定してください"
        )
        raise KintBadGatewayError(
            code="GMAIL_NOT_CONFIGURED",
            message="Gmail API の認証情報が設定されていません",
        )
    if not os.path.exists(settings.gmail_oauth_credentials_file):
        creds_path = settings.gmail_oauth_credentials_file
        logger.error("Gmail API 認証ファイルが見つかりません: %s", creds_path)
        raise KintBadGatewayError(
            code="GMAIL_CREDENTIALS_NOT_FOUND",
            message=f"Gmail API 認証ファイルが見つかりません: {creds_path}",
        )

    logger.info("Gmail OAuth 初回認可フローを開始します")
    from google_auth_oauthlib.flow import InstalledAppFlow  # noqa: PLC0415

    flow = InstalledAppFlow.from_client_secrets_file(
        settings.gmail_oauth_credentials_file,
        [_GMAIL_SCOPE],
    )
    creds = flow.run_local_server(port=0)
    _save_credentials(creds)
    logger.info(
        "Gmail OAuth 初回認可が完了しました。トークンを保存しました: %s",
        settings.gmail_token_file,
    )
    return creds


def _save_credentials(creds: Credentials) -> None:
    """認証情報をトークンファイルに保存する。"""
    with open(settings.gmail_token_file, "w") as f:
        f.write(creds.to_json())


def _sender_email() -> str:
    """送信元メールアドレスを返す。GMAIL_USER が設定されていればそれを優先する。"""
    return settings.gmail_user or settings.gmail_sender_email


def _build_verification_email(
    to: str,
    token: str,
    verification_type: str,
) -> MIMEMultipart:
    """確認メールの MIME メッセージを生成する。"""
    confirm_url = f"{settings.app_base_url}/email-verifications/confirm?token={token}"
    sender = _sender_email()

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

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    return msg


class GmailAdapter:
    """Gmail API を使って確認メールを送信するアダプター。"""

    def send_email_verification(
        self,
        to: str,
        token: str,
        verification_type: str,
    ) -> None:
        """確認メールを送信する。送信失敗時は KintBadGatewayError を発生させる。"""
        logger.debug("確認メール送信を開始します: to=%s type=%s", to, verification_type)
        try:
            creds = _load_credentials()
            service = build("gmail", "v1", credentials=creds)

            msg = _build_verification_email(to, token, verification_type)
            raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
            service.users().messages().send(userId="me", body={"raw": raw}).execute()
            logger.info("確認メールを送信しました: to=%s type=%s", to, verification_type)
        except KintBadGatewayError:
            raise
        except (HttpError, TransportError, OSError) as e:
            logger.error("Gmail API 送信エラー: to=%s type=%s error=%s", to, verification_type, e)
            raise KintBadGatewayError(
                code="GMAIL_SEND_FAILED",
                message="確認メールの送信に失敗しました",
            ) from e

    def send_email(
        self,
        to: str,
        subject: str,
        body_text: str,
    ) -> None:
        """任意のメールを送信する。送信失敗時は KintBadGatewayError を発生させる。"""
        logger.debug("メール送信を開始します: to=%s subject=%s", to, subject)
        try:
            creds = _load_credentials()
            service = build("gmail", "v1", credentials=creds)

            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = _sender_email()
            msg["To"] = to
            msg.attach(MIMEText(body_text, "plain", "utf-8"))

            raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
            service.users().messages().send(userId="me", body={"raw": raw}).execute()
            logger.info("メールを送信しました: to=%s subject=%s", to, subject)
        except KintBadGatewayError:
            raise
        except (HttpError, TransportError, OSError) as e:
            logger.error("Gmail API 送信エラー: to=%s subject=%s error=%s", to, subject, e)
            raise KintBadGatewayError(
                code="GMAIL_SEND_FAILED",
                message="メールの送信に失敗しました",
            ) from e

