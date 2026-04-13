"""マイページ API (BE-09) および Gmail 確認メール (BE-10) のテスト。"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import bcrypt
import pytest
from httpx import AsyncClient


def _hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


async def _create_user(session, **kwargs) -> object:
    """テスト用ユーザーを DB に作成する。"""
    from kint.models.user import User

    defaults = {
        "id": "testuser",
        "name": "テストユーザー",
        "full_name": "Test User",
        "email": "test@example.com",
        "password_hash": _hash_password("Password1"),
        "role": "employee",
        "is_active": 1,
        "token_version": 1,
    }
    defaults.update(kwargs)
    user = User(**defaults)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _login(
    client: AsyncClient, account_id: str = "testuser", password: str = "Password1"
) -> str:
    """ログインして Bearer トークンを返す。"""
    resp = await client.post(
        "/api/v1/auth/login",
        json={"account_id": account_id, "password": password},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# GET /api/v1/me
# ---------------------------------------------------------------------------


class TestGetMe:
    async def test_get_me_returns_profile(self, client: AsyncClient, session: object) -> None:
        """認証済みユーザーのプロフィールが返る。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == "testuser"
        assert data["name"] == "テストユーザー"
        assert data["email"] == "test@example.com"
        assert "email_verification_status" in data

    async def test_get_me_unauthenticated(self, client: AsyncClient) -> None:
        """未認証時は 401 が返る。"""
        resp = await client.get("/api/v1/me")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /api/v1/me/profile
# ---------------------------------------------------------------------------


class TestUpdateProfile:
    async def test_update_name(self, client: AsyncClient, session: object) -> None:
        """name を更新できる。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "新しい名前"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "新しい名前"

    async def test_update_full_name(self, client: AsyncClient, session: object) -> None:
        """full_name を更新できる。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={"full_name": "フルネーム更新"},
        )
        assert resp.status_code == 200
        assert resp.json()["full_name"] == "フルネーム更新"

    async def test_update_both_fields(self, client: AsyncClient, session: object) -> None:
        """name と full_name を同時に更新できる。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "新名前", "full_name": "新氏名"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "新名前"
        assert data["full_name"] == "新氏名"

    async def test_update_empty_body_returns_422(
        self, client: AsyncClient, session: object
    ) -> None:
        """空のボディは 422 を返す。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )
        assert resp.status_code == 422

    async def test_update_profile_unauthenticated(self, client: AsyncClient) -> None:
        """未認証時は 401 が返る。"""
        resp = await client.patch("/api/v1/me/profile", json={"name": "test"})
        assert resp.status_code == 401

    async def test_name_too_long_returns_422(self, client: AsyncClient, session: object) -> None:
        """name が 50 文字超で 422 を返す。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/profile",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "a" * 51},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/v1/me/email-change-requests
# ---------------------------------------------------------------------------


class TestEmailChangeRequests:
    async def test_request_email_change_accepted(
        self, client: AsyncClient, session: object
    ) -> None:
        """確認メール送信が202で受け付けられる。"""
        await _create_user(session)
        token = await _login(client)

        with patch("kint.services.user.GmailAdapter.send_email_verification") as mock_send:
            mock_send.return_value = None
            resp = await client.post(
                "/api/v1/me/email-change-requests",
                headers={"Authorization": f"Bearer {token}"},
                json={"new_email": "newemail@example.com"},
            )

        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "pending_confirmation"
        assert data["requested_email"] == "newemail@example.com"
        assert "expires_at" in data
        assert mock_send.called

    async def test_request_email_change_duplicate_returns_409(
        self, client: AsyncClient, session: object
    ) -> None:
        """既存メールアドレスと重複する場合は 409 を返す。"""
        await _create_user(session)
        await _create_user(
            session,
            id="otheruser",
            email="other@example.com",
        )
        token = await _login(client)

        resp = await client.post(
            "/api/v1/me/email-change-requests",
            headers={"Authorization": f"Bearer {token}"},
            json={"new_email": "other@example.com"},
        )
        assert resp.status_code == 409

    async def test_request_email_change_gmail_failure_returns_502(
        self, client: AsyncClient, session: object
    ) -> None:
        """Gmail 送信失敗時は 502 を返す。"""
        from kint.exceptions import KintBadGatewayError

        await _create_user(session)
        token = await _login(client)

        with patch("kint.services.user.GmailAdapter.send_email_verification") as mock_send:
            mock_send.side_effect = KintBadGatewayError(
                code="GMAIL_SEND_FAILED",
                message="送信失敗",
            )
            resp = await client.post(
                "/api/v1/me/email-change-requests",
                headers={"Authorization": f"Bearer {token}"},
                json={"new_email": "newemail@example.com"},
            )
        assert resp.status_code == 502

    async def test_request_email_change_unauthenticated(self, client: AsyncClient) -> None:
        """未認証時は 401。"""
        resp = await client.post(
            "/api/v1/me/email-change-requests",
            json={"new_email": "x@y.com"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/v1/email-verifications/confirm
# ---------------------------------------------------------------------------


class TestEmailVerificationConfirm:
    async def _create_evr(
        self,
        session: object,
        user_id: str,
        token: str,
        verification_type: str = "email_change",
        requested_email: str = "new@example.com",
        expired: bool = False,
    ) -> None:
        """テスト用 EmailVerificationRequest を DB に作成する。"""
        import hashlib
        import uuid

        from kint.models.email_verification import EmailVerificationRequest

        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires_at = (
            datetime.now(tz=UTC).replace(tzinfo=None) - timedelta(hours=1)
            if expired
            else datetime.now(tz=UTC).replace(tzinfo=None) + timedelta(hours=24)
        )
        evr = EmailVerificationRequest(
            id=str(uuid.uuid4()),
            user_id=user_id,
            requested_email=requested_email,
            verification_type=verification_type,
            token_hash=token_hash,
            sent_via="gmail_api",
            expires_at=expires_at,
        )
        session.add(evr)
        await session.commit()

    async def test_confirm_email_change(self, client: AsyncClient, session: object) -> None:
        """email_change トークンを確認するとメールが更新される。"""
        from sqlalchemy import select

        from kint.models.user import User

        await _create_user(session)
        raw_token = "validtoken123"
        await self._create_evr(session, "testuser", raw_token, "email_change", "new@example.com")

        resp = await client.post(
            "/api/v1/email-verifications/confirm",
            json={"token": raw_token},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["verification_type"] == "email_change"
        assert data["email"] == "new@example.com"
        assert data["status"] == "confirmed"

        # DB でメールアドレスが更新されていることを確認
        result = await session.execute(select(User).where(User.id == "testuser"))
        user = result.scalar_one()
        assert user.email == "new@example.com"

    async def test_confirm_signup(self, client: AsyncClient, session: object) -> None:
        """signup トークンを確認すると email_verified_at が設定される。"""
        from sqlalchemy import select

        from kint.models.user import User

        await _create_user(session)
        raw_token = "signuptoken456"
        await self._create_evr(session, "testuser", raw_token, "signup", "test@example.com")

        resp = await client.post(
            "/api/v1/email-verifications/confirm",
            json={"token": raw_token},
        )
        assert resp.status_code == 200
        assert resp.json()["verification_type"] == "signup"

        result = await session.execute(select(User).where(User.id == "testuser"))
        user = result.scalar_one()
        assert user.email_verified_at is not None

    async def test_confirm_invalid_token_returns_400(self, client: AsyncClient) -> None:
        """存在しないトークンは 400 を返す。"""
        resp = await client.post(
            "/api/v1/email-verifications/confirm",
            json={"token": "nonexistenttoken"},
        )
        assert resp.status_code == 400

    async def test_confirm_expired_token_returns_400(
        self, client: AsyncClient, session: object
    ) -> None:
        """期限切れトークンは 400 を返す。"""
        await _create_user(session)
        raw_token = "expiredtoken789"
        await self._create_evr(
            session, "testuser", raw_token, "email_change", "new@example.com", expired=True
        )

        resp = await client.post(
            "/api/v1/email-verifications/confirm",
            json={"token": raw_token},
        )
        assert resp.status_code == 400
        assert resp.json()["code"] == "TOKEN_EXPIRED"

    async def test_confirm_used_token_returns_400(
        self, client: AsyncClient, session: object
    ) -> None:
        """使用済みトークンは 400 を返す。"""
        await _create_user(session)
        raw_token = "usedtoken000"
        await self._create_evr(session, "testuser", raw_token, "email_change")

        # 1回目
        await client.post("/api/v1/email-verifications/confirm", json={"token": raw_token})
        # 2回目
        resp = await client.post("/api/v1/email-verifications/confirm", json={"token": raw_token})
        assert resp.status_code == 400
        assert resp.json()["code"] == "TOKEN_ALREADY_USED"


# ---------------------------------------------------------------------------
# PATCH /api/v1/me/password
# ---------------------------------------------------------------------------


class TestChangePassword:
    async def test_change_password_success(self, client: AsyncClient, session: object) -> None:
        """正しい current_password で新しいパスワードに変更できる。204 を返す。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "Password1", "new_password": "NewPass2"},
        )
        assert resp.status_code == 204

    async def test_change_password_invalidates_session(
        self, client: AsyncClient, session: object
    ) -> None:
        """パスワード変更後に古いトークンが無効になる。"""
        await _create_user(session)
        old_token = await _login(client)

        # パスワード変更
        await client.patch(
            "/api/v1/me/password",
            headers={"Authorization": f"Bearer {old_token}"},
            json={"current_password": "Password1", "new_password": "NewPass2"},
        )

        # 古いトークンで /me にアクセス → 401 になるはず
        resp = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {old_token}"})
        assert resp.status_code == 401
        assert resp.json()["code"] == "TOKEN_INVALIDATED"

    async def test_change_password_wrong_current_returns_401(
        self, client: AsyncClient, session: object
    ) -> None:
        """current_password が不一致の場合は 401 を返す。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "WrongPass9", "new_password": "NewPass2"},
        )
        assert resp.status_code == 401
        assert resp.json()["code"] == "INVALID_PASSWORD"

    async def test_change_password_same_password_returns_422(
        self, client: AsyncClient, session: object
    ) -> None:
        """new_password が current_password と同一の場合は 422 を返す。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "Password1", "new_password": "Password1"},
        )
        assert resp.status_code == 422

    @pytest.mark.parametrize(
        "new_password",
        [
            "short1",  # 7文字未満
            "nonnumber",  # 数字なし
            "12345678",  # 英字なし
        ],
    )
    async def test_change_password_weak_password_returns_422(
        self, client: AsyncClient, session: object, new_password: str
    ) -> None:
        """強度不足のパスワードは 422 を返す。"""
        await _create_user(session)
        token = await _login(client)

        resp = await client.patch(
            "/api/v1/me/password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "Password1", "new_password": new_password},
        )
        assert resp.status_code == 422

    async def test_change_password_unauthenticated(self, client: AsyncClient) -> None:
        """未認証時は 401。"""
        resp = await client.patch(
            "/api/v1/me/password",
            json={"current_password": "Password1", "new_password": "NewPass2"},
        )
        assert resp.status_code == 401
