"""Resend メール送信アダプターのテスト。"""

import json

import httpx
import pytest

from kint.config import settings
from kint.exceptions import KintBadGatewayError
from kint.services.mailer import MailAdapter


@pytest.fixture(autouse=True)
def _resend_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Resend の設定をテスト用の値にする。"""
    monkeypatch.setattr(settings, "resend_api_key", "re_test_key")
    monkeypatch.setattr(settings, "mail_from", "noreply@example.com")
    monkeypatch.setattr(settings, "mail_reply_to", None)
    monkeypatch.setattr(settings, "site_name", "Kint")


def _capture_transport(
    requests: list[httpx.Request], status_code: int = 200, body: dict | None = None
) -> httpx.MockTransport:
    """送信リクエストを記録して固定レスポンスを返すトランスポート。"""

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status_code, json=body or {"id": "email-id"})

    return httpx.MockTransport(handler)


def test_send_email_posts_to_resend() -> None:
    """Resend API に差出人・返信先・宛先・件名・本文を送る。"""
    requests: list[httpx.Request] = []
    MailAdapter(transport=_capture_transport(requests)).send_email(
        "user@example.com", "件名", "本文"
    )

    assert len(requests) == 1
    req = requests[0]
    assert str(req.url) == "https://api.resend.com/emails"
    assert req.headers["Authorization"] == "Bearer re_test_key"
    payload = json.loads(req.content)
    assert payload == {
        "from": "Kint <noreply@example.com>",
        "reply_to": "noreply@example.com",
        "to": ["user@example.com"],
        "subject": "件名",
        "text": "本文",
    }


def test_send_email_uses_sender_name_and_reply_to(monkeypatch: pytest.MonkeyPatch) -> None:
    """sender_name と MAIL_REPLY_TO が指定されていればそれを使う。"""
    monkeypatch.setattr(settings, "mail_reply_to", "contact@example.com")
    requests: list[httpx.Request] = []
    MailAdapter(transport=_capture_transport(requests)).send_email(
        "user@example.com", "件名", "本文", sender_name="つくまな勤怠"
    )

    payload = json.loads(requests[0].content)
    assert payload["from"] == "つくまな勤怠 <noreply@example.com>"
    assert payload["reply_to"] == "contact@example.com"


def test_send_email_verification_builds_confirm_link() -> None:
    """確認メールには確認リンクが含まれる。"""
    requests: list[httpx.Request] = []
    MailAdapter(transport=_capture_transport(requests)).send_email_verification(
        "user@example.com", "tok123", "email_change"
    )

    payload = json.loads(requests[0].content)
    assert payload["subject"] == "【Kint】メールアドレス変更の確認"
    assert f"{settings.app_base_url}/email-verifications/confirm?token=tok123" in payload["text"]


@pytest.mark.parametrize("missing", ["resend_api_key", "mail_from"])
def test_send_email_not_configured(monkeypatch: pytest.MonkeyPatch, missing: str) -> None:
    """API キーか送信元が未設定なら MAIL_NOT_CONFIGURED。"""
    monkeypatch.setattr(settings, missing, None)
    requests: list[httpx.Request] = []
    with pytest.raises(KintBadGatewayError) as exc:
        MailAdapter(transport=_capture_transport(requests)).send_email("a@example.com", "s", "b")
    assert exc.value.code == "MAIL_NOT_CONFIGURED"
    assert requests == []


@pytest.mark.parametrize("status_code", [403, 422, 500])
def test_send_email_error_response(status_code: int) -> None:
    """Resend がエラーを返したら MAIL_SEND_FAILED。"""
    requests: list[httpx.Request] = []
    transport = _capture_transport(
        requests, status_code, {"name": "validation_error", "message": "invalid from"}
    )
    with pytest.raises(KintBadGatewayError) as exc:
        MailAdapter(transport=transport).send_email("a@example.com", "s", "b")
    assert exc.value.code == "MAIL_SEND_FAILED"


def test_send_email_network_error() -> None:
    """通信エラーなら MAIL_SEND_FAILED。"""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(KintBadGatewayError) as exc:
        MailAdapter(transport=httpx.MockTransport(handler)).send_email("a@example.com", "s", "b")
    assert exc.value.code == "MAIL_SEND_FAILED"
