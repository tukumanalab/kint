"""顔認証打刻機能のテスト。"""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from kint.config import settings as env_settings
from kint.models.shift import Shift
from kint.models.user import User

_ALGORITHM = "HS256"


def _vec(offset: float) -> list[float]:
    """先頭要素のみ offset、残り127要素を0とした128次元テスト用ディスクリプタを返す。
    2つの _vec の距離は offset の差の絶対値になる。
    """
    return [offset] + [0.0] * 127


async def _create_user(session: AsyncSession, **kwargs) -> User:
    """テスト用ユーザーを DB に作成する。"""
    defaults = {
        "id": "testuser",
        "name": "テストユーザー",
        "full_name": "Test User",
        "email": "test@example.com",
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


async def _create_shift(
    session: AsyncSession, *, user_id: str, start_time: datetime, end_time: datetime
) -> Shift:
    """テスト用シフトを作成する。"""
    shift = Shift(
        id=f"shift-{user_id}",
        user_id=user_id,
        shift_date=start_time.date(),
        start_time=start_time,
        end_time=end_time,
        google_event_id=f"event-{user_id}",
    )
    session.add(shift)
    await session.commit()
    await session.refresh(shift)
    return shift


async def _login(account_id: str) -> str:
    """JWTトークンを直接生成して返す。"""
    from kint.routers.auth import _create_access_token

    return _create_access_token(account_id, 1)


async def _get_device_token(client: AsyncClient, session: AsyncSession) -> str:
    """管理者としてログインし打刻端末トークンを発行する。"""
    await _create_user(session, id="device-admin", role="admin", email="device-admin@example.com")
    admin_token = await _login("device-admin")
    resp = await client.post(
        "/api/v1/punch-devices/token",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "受付端末"},
    )
    assert resp.status_code == 200
    return resp.json()["device_token"]


async def _enable_face_punch(client: AsyncClient, admin_token: str) -> None:
    """設定 API 経由で顔認証打刻を有効化する。"""
    resp = await client.patch(
        "/api/v1/settings",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"face_punch_enabled": True},
    )
    assert resp.status_code == 200
    assert resp.json()["face_punch_enabled"] is True


class TestMyFaceRegistration:
    """本人 (/me/face) の登録・状況・削除テスト。"""

    async def test_status_initially_unregistered(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await _create_user(session)
        token = await _login("testuser")
        resp = await client.get("/api/v1/me/face", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"registered": False, "count": 0, "updated_at": None}

    async def test_register_and_status(self, client: AsyncClient, session: AsyncSession) -> None:
        await _create_user(session)
        token = await _login("testuser")
        resp = await client.put(
            "/api/v1/me/face",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptors": [_vec(0.0), _vec(0.01)]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["registered"] is True
        assert data["count"] == 2
        assert data["updated_at"] is not None

        status_resp = await client.get(
            "/api/v1/me/face", headers={"Authorization": f"Bearer {token}"}
        )
        assert status_resp.json()["count"] == 2

    async def test_register_replaces_existing(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await _create_user(session)
        token = await _login("testuser")
        await client.put(
            "/api/v1/me/face",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptors": [_vec(0.0), _vec(0.1), _vec(0.2)]},
        )
        resp = await client.put(
            "/api/v1/me/face",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptors": [_vec(0.5)]},
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    async def test_delete(self, client: AsyncClient, session: AsyncSession) -> None:
        await _create_user(session)
        token = await _login("testuser")
        await client.put(
            "/api/v1/me/face",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptors": [_vec(0.0)]},
        )
        del_resp = await client.delete(
            "/api/v1/me/face", headers={"Authorization": f"Bearer {token}"}
        )
        assert del_resp.status_code == 204

        status_resp = await client.get(
            "/api/v1/me/face", headers={"Authorization": f"Bearer {token}"}
        )
        assert status_resp.json()["registered"] is False

    async def test_register_zero_descriptors_rejected(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await _create_user(session)
        token = await _login("testuser")
        resp = await client.put(
            "/api/v1/me/face",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptors": []},
        )
        assert resp.status_code == 422

    async def test_register_too_many_descriptors_rejected(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await _create_user(session)
        token = await _login("testuser")
        resp = await client.put(
            "/api/v1/me/face",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptors": [_vec(0.0)] * 6},
        )
        assert resp.status_code == 422

    async def test_register_wrong_dimension_rejected(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await _create_user(session)
        token = await _login("testuser")
        resp = await client.put(
            "/api/v1/me/face",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptors": [[0.0] * 127]},
        )
        assert resp.status_code == 422

    async def test_admin_cannot_register_own_face(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """管理者は自分の顔データを登録できない。"""
        await _create_user(session, id="admin-1", role="admin", email="admin-1@example.com")
        token = await _login("admin-1")
        resp = await client.put(
            "/api/v1/me/face",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptors": [_vec(0.0)]},
        )
        assert resp.status_code == 403
        assert resp.json()["code"] == "ADMIN_FACE_NOT_ALLOWED"


class TestAdminFaceManagement:
    """管理者専用 (/users/{user_id}/face) のテスト。"""

    async def test_non_admin_forbidden(self, client: AsyncClient, session: AsyncSession) -> None:
        await _create_user(session, id="employee-1", email="employee-1@example.com")
        await _create_user(session, id="employee-2", email="employee-2@example.com")
        token = await _login("employee-1")

        for method, kwargs in (
            ("get", {}),
            ("put", {"json": {"descriptors": [_vec(0.0)]}}),
            ("delete", {}),
        ):
            resp = await getattr(client, method)(
                "/api/v1/users/employee-2/face",
                headers={"Authorization": f"Bearer {token}"},
                **kwargs,
            )
            assert resp.status_code == 403

    async def test_admin_register_and_delete_for_target_user(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await _create_user(session, id="admin-1", role="admin", email="admin-1@example.com")
        await _create_user(session, id="employee-1", email="employee-1@example.com")
        admin_token = await _login("admin-1")

        put_resp = await client.put(
            "/api/v1/users/employee-1/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [_vec(0.0), _vec(0.2)]},
        )
        assert put_resp.status_code == 200
        assert put_resp.json()["count"] == 2

        get_resp = await client.get(
            "/api/v1/users/employee-1/face", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert get_resp.json()["count"] == 2

        del_resp = await client.delete(
            "/api/v1/users/employee-1/face", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert del_resp.status_code == 204

        get_resp2 = await client.get(
            "/api/v1/users/employee-1/face", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert get_resp2.json()["registered"] is False

    async def test_admin_cannot_register_target_admin_user(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await _create_user(session, id="admin-1", role="admin", email="admin-1@example.com")
        await _create_user(session, id="admin-2", role="admin", email="admin-2@example.com")
        admin_token = await _login("admin-1")

        resp = await client.put(
            "/api/v1/users/admin-2/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [_vec(0.0)]},
        )
        assert resp.status_code == 403
        assert resp.json()["code"] == "ADMIN_FACE_NOT_ALLOWED"


class TestFacePunchConfig:
    """GET /face-punch/config のテスト。"""

    async def test_missing_device_token_returns_401(self, client: AsyncClient) -> None:
        resp = await client.get("/api/v1/face-punch/config")
        assert resp.status_code == 401

    async def test_invalid_device_token_returns_401(self, client: AsyncClient) -> None:
        resp = await client.get(
            "/api/v1/face-punch/config", headers={"X-Punch-Device-Token": "not-a-jwt"}
        )
        assert resp.status_code == 401

    async def test_valid_device_token_returns_config(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        device_token = await _get_device_token(client, session)
        resp = await client.get(
            "/api/v1/face-punch/config", headers={"X-Punch-Device-Token": device_token}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {"enabled", "countdown_seconds", "cooldown_seconds"}
        assert data["enabled"] is False  # デフォルトは無効


class TestFacePunchIdentify:
    """POST /face-punch/identify のテスト。"""

    async def test_missing_device_token_returns_401(self, client: AsyncClient) -> None:
        resp = await client.post("/api/v1/face-punch/identify", json={"descriptor": _vec(0.0)})
        assert resp.status_code == 401

    async def test_disabled_returns_403(self, client: AsyncClient, session: AsyncSession) -> None:
        device_token = await _get_device_token(client, session)
        resp = await client.post(
            "/api/v1/face-punch/identify",
            headers={"X-Punch-Device-Token": device_token},
            json={"descriptor": _vec(0.0)},
        )
        assert resp.status_code == 403
        assert resp.json()["code"] == "FACE_PUNCH_DISABLED"

    async def test_shift_user_matched_without_confirmation(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        device_token = await _get_device_token(client, session)
        admin_token = await _login("device-admin")
        await _enable_face_punch(client, admin_token)

        now = datetime.now(tz=UTC)
        user = await _create_user(session, id="shift-user", email="shift-user@example.com")
        await _create_shift(
            session,
            user_id=user.id,
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(hours=4),
        )
        await client.put(
            "/api/v1/users/shift-user/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [_vec(0.0)]},
        )

        resp = await client.post(
            "/api/v1/face-punch/identify",
            headers={"X-Punch-Device-Token": device_token},
            json={"descriptor": _vec(0.0)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["matched"] is True
        assert data["user_id"] == "shift-user"
        assert data["has_shift"] is True
        assert data["requires_confirmation"] is False
        assert data["greeting_kind"] == "check_in"
        assert data["face_match_token"]

    async def test_non_shift_user_requires_confirmation(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        device_token = await _get_device_token(client, session)
        admin_token = await _login("device-admin")
        await _enable_face_punch(client, admin_token)

        await _create_user(session, id="no-shift-user", email="no-shift-user@example.com")
        await client.put(
            "/api/v1/users/no-shift-user/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [_vec(0.0)]},
        )

        resp = await client.post(
            "/api/v1/face-punch/identify",
            headers={"X-Punch-Device-Token": device_token},
            json={"descriptor": _vec(0.0)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["matched"] is True
        assert data["has_shift"] is False
        assert data["requires_confirmation"] is True
        assert data["greeting_kind"] == "check_in"

    async def test_beyond_threshold_unmatched(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        device_token = await _get_device_token(client, session)
        admin_token = await _login("device-admin")
        await _enable_face_punch(client, admin_token)

        await _create_user(session, id="far-user", email="far-user@example.com")
        await client.put(
            "/api/v1/users/far-user/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [_vec(1.0)]},
        )

        resp = await client.post(
            "/api/v1/face-punch/identify",
            headers={"X-Punch-Device-Token": device_token},
            json={"descriptor": _vec(0.0)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["matched"] is False
        assert data["face_match_token"] is None

    async def test_ambiguous_candidates_unmatched(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        device_token = await _get_device_token(client, session)
        admin_token = await _login("device-admin")
        await _enable_face_punch(client, admin_token)

        await _create_user(session, id="cand-a", email="cand-a@example.com")
        await _create_user(session, id="cand-b", email="cand-b@example.com")
        await client.put(
            "/api/v1/users/cand-a/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [_vec(0.0)]},
        )
        await client.put(
            "/api/v1/users/cand-b/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [_vec(0.02)]},
        )

        resp = await client.post(
            "/api/v1/face-punch/identify",
            headers={"X-Punch-Device-Token": device_token},
            json={"descriptor": _vec(0.0)},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["matched"] is False


class TestFaceMatchPunch:
    """face_match_token を用いた /punches 打刻のテスト。"""

    async def test_check_in_then_check_out(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        device_token = await _get_device_token(client, session)
        admin_token = await _login("device-admin")
        await _enable_face_punch(client, admin_token)

        now = datetime.now(tz=UTC)
        user = await _create_user(session, id="face-punch-user", email="fpu@example.com")
        await _create_shift(
            session,
            user_id=user.id,
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(hours=4),
        )
        await client.put(
            "/api/v1/users/face-punch-user/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [_vec(0.0)]},
        )

        identify_resp = await client.post(
            "/api/v1/face-punch/identify",
            headers={"X-Punch-Device-Token": device_token},
            json={"descriptor": _vec(0.0)},
        )
        token1 = identify_resp.json()["face_match_token"]
        assert token1

        punch_in_resp = await client.post(
            "/api/v1/punches",
            headers={"X-Punch-Device-Token": device_token},
            json={
                "device_id": "kiosk-1",
                "occurred_at": now.isoformat(),
                "face_match_token": token1,
            },
        )
        assert punch_in_resp.status_code == 200
        in_data = punch_in_resp.json()
        assert in_data["action"] == "check_in"
        assert in_data["method"] == "face"
        assert in_data["user_id"] == "face-punch-user"

        # 退勤: 再度 identify すると未退勤レコードにより greeting_kind=check_out
        later = now + timedelta(hours=2)
        identify_resp2 = await client.post(
            "/api/v1/face-punch/identify",
            headers={"X-Punch-Device-Token": device_token},
            json={"descriptor": _vec(0.0)},
        )
        assert identify_resp2.json()["greeting_kind"] == "check_out"
        token2 = identify_resp2.json()["face_match_token"]

        punch_out_resp = await client.post(
            "/api/v1/punches",
            headers={"X-Punch-Device-Token": device_token},
            json={
                "device_id": "kiosk-1",
                "occurred_at": later.isoformat(),
                "face_match_token": token2,
            },
        )
        assert punch_out_resp.status_code == 200
        out_data = punch_out_resp.json()
        assert out_data["action"] == "check_out"
        assert out_data["method"] == "face"

    async def test_expired_token_rejected(self, client: AsyncClient, session: AsyncSession) -> None:
        device_token = await _get_device_token(client, session)
        await _create_user(session, id="expired-user", email="expired-user@example.com")

        expired_token = jwt.encode(
            {
                "sub": "expired-user",
                "type": "face_match",
                "exp": datetime.now(tz=UTC) - timedelta(seconds=5),
            },
            env_settings.secret_key,
            algorithm=_ALGORITHM,
        )
        resp = await client.post(
            "/api/v1/punches",
            headers={"X-Punch-Device-Token": device_token},
            json={
                "device_id": "kiosk-1",
                "occurred_at": datetime.now(tz=UTC).isoformat(),
                "face_match_token": expired_token,
            },
        )
        assert resp.status_code == 401
        assert resp.json()["code"] == "FACE_MATCH_TOKEN_INVALID"

    async def test_tampered_token_rejected(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        device_token = await _get_device_token(client, session)
        resp = await client.post(
            "/api/v1/punches",
            headers={"X-Punch-Device-Token": device_token},
            json={
                "device_id": "kiosk-1",
                "occurred_at": datetime.now(tz=UTC).isoformat(),
                "face_match_token": "this.is.not-a-valid-jwt",
            },
        )
        assert resp.status_code == 401
        assert resp.json()["code"] == "FACE_MATCH_TOKEN_INVALID"


class TestFaceVerify:
    """顔認証テスト (POST /me/face/verify, /users/{id}/face/verify) のテスト。"""

    @staticmethod
    async def _register(client: AsyncClient, user_id: str, vec: list[float]) -> None:
        """管理者経由で顔データを登録する。"""
        admin_token = await _login("verify-admin")
        resp = await client.put(
            f"/api/v1/users/{user_id}/face",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptors": [vec]},
        )
        assert resp.status_code == 200

    @staticmethod
    async def _verify(client: AsyncClient, user_id: str, vec: list[float]):
        token = await _login(user_id)
        return await client.post(
            "/api/v1/me/face/verify",
            headers={"Authorization": f"Bearer {token}"},
            json={"descriptor": vec},
        )

    async def _setup(self, session: AsyncSession) -> None:
        await _create_user(session, id="verify-admin", role="admin", email="va@example.com")
        await _create_user(session, id="me", email="me@example.com")

    async def test_recognized_with_shift(self, client: AsyncClient, session: AsyncSession) -> None:
        await self._setup(session)
        now = datetime.now(tz=UTC)
        await _create_shift(
            session,
            user_id="me",
            start_time=now - timedelta(hours=1),
            end_time=now + timedelta(hours=4),
        )
        await self._register(client, "me", _vec(0.0))
        resp = await self._verify(client, "me", _vec(0.1))
        assert resp.status_code == 200
        data = resp.json()
        assert data["result"] == "recognized"
        assert data["reason"] == "ok"
        assert data["has_shift"] is True
        assert data["distance"] == 0.1
        assert data["threshold"] == 0.45
        assert data["threshold_no_shift"] == 0.38

    async def test_recognized_with_confirmation_without_shift(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await self._setup(session)
        await self._register(client, "me", _vec(0.0))
        data = (await self._verify(client, "me", _vec(0.1))).json()
        assert data["result"] == "recognized_with_confirmation"
        assert data["reason"] == "ok"
        assert data["has_shift"] is False

    async def test_too_far(self, client: AsyncClient, session: AsyncSession) -> None:
        await self._setup(session)
        await self._register(client, "me", _vec(0.0))
        data = (await self._verify(client, "me", _vec(1.0))).json()
        assert data["result"] == "not_recognized"
        assert data["reason"] == "too_far"

    async def test_other_user_closer(self, client: AsyncClient, session: AsyncSession) -> None:
        await self._setup(session)
        await _create_user(session, id="other", name="他人", email="other@example.com")
        await self._register(client, "me", _vec(0.0))
        await self._register(client, "other", _vec(0.3))
        data = (await self._verify(client, "me", _vec(0.3))).json()
        assert data["result"] == "not_recognized"
        assert data["reason"] == "other_user_closer"

    async def test_ambiguous(self, client: AsyncClient, session: AsyncSession) -> None:
        await self._setup(session)
        await _create_user(session, id="other", name="他人", email="other@example.com")
        await self._register(client, "me", _vec(0.0))
        await self._register(client, "other", _vec(0.03))
        data = (await self._verify(client, "me", _vec(0.0))).json()
        assert data["result"] == "not_recognized"
        assert data["reason"] == "ambiguous"

    async def test_response_has_no_other_user_info(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await self._setup(session)
        await _create_user(session, id="other", name="他人さん", email="other@example.com")
        await self._register(client, "me", _vec(0.0))
        await self._register(client, "other", _vec(0.1))
        resp = await self._verify(client, "me", _vec(0.0))
        assert set(resp.json().keys()) == {
            "result",
            "reason",
            "distance",
            "threshold",
            "threshold_no_shift",
            "has_shift",
        }
        assert "other" not in resp.text and "他人" not in resp.text

    async def test_not_registered_returns_404(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await self._setup(session)
        resp = await self._verify(client, "me", _vec(0.0))
        assert resp.status_code == 404
        assert resp.json()["code"] == "FACE_NOT_REGISTERED"

    async def test_admin_endpoint_and_non_admin_forbidden(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        await self._setup(session)
        await _create_user(session, id="emp2", email="emp2@example.com")
        await self._register(client, "me", _vec(0.0))
        admin_token = await _login("verify-admin")
        resp = await client.post(
            "/api/v1/users/me/face/verify",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"descriptor": _vec(0.05)},
        )
        assert resp.status_code == 200
        assert resp.json()["result"] == "recognized_with_confirmation"

        emp_token = await _login("emp2")
        forbidden = await client.post(
            "/api/v1/users/me/face/verify",
            headers={"Authorization": f"Bearer {emp_token}"},
            json={"descriptor": _vec(0.05)},
        )
        assert forbidden.status_code == 403
