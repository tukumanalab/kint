from httpx import AsyncClient


async def _create_user(session, **kwargs) -> object:
    """テスト用ユーザーを DB に作成する。"""
    from kint.models.user import User

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


async def _login(account_id: str = "testuser") -> str:
    """JWTトークンを直接生成して返す。"""
    from kint.routers.auth import _create_access_token

    return _create_access_token(account_id, 1)


class TestPunchDeviceToken:
    async def test_create_token_unauthenticated(self, client: AsyncClient) -> None:
        """未認証時は 401 を返す。"""
        resp = await client.post("/api/v1/punch-devices/token", json={"name": "端末1"})
        assert resp.status_code == 401

    async def test_create_token_non_admin_returns_403(
        self, client: AsyncClient, session: object
    ) -> None:
        """一般ユーザーは 403 を返す。"""
        await _create_user(session, id="employee-user", role="employee")
        token = await _login("employee-user")

        resp = await client.post(
            "/api/v1/punch-devices/token",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "端末1"},
        )
        assert resp.status_code == 403

    async def test_create_token_admin_succeeds(self, client: AsyncClient, session: object) -> None:
        """管理者はトークンを発行できる。"""
        await _create_user(session, id="admin-user", role="admin")
        token = await _login("admin-user")

        resp = await client.post(
            "/api/v1/punch-devices/token",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "受付iPad"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "device_token" in data
        assert data["name"] == "受付iPad"


class TestPunchDeviceVerify:
    async def test_verify_valid_token(self, client: AsyncClient, session: object) -> None:
        """有効なデバイストークンを検証すると valid=True と端末名が返る。"""
        await _create_user(session, id="admin-user", role="admin")
        token = await _login("admin-user")

        # トークンを生成
        token_resp = await client.post(
            "/api/v1/punch-devices/token",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "受付iPad"},
        )
        device_token = token_resp.json()["device_token"]

        # 検証
        verify_resp = await client.get(
            "/api/v1/punch-devices/verify",
            headers={"X-Punch-Device-Token": device_token},
        )
        assert verify_resp.status_code == 200
        verify_data = verify_resp.json()
        assert verify_data["valid"] is True
        assert verify_data["name"] == "受付iPad"

    async def test_verify_invalid_token(self, client: AsyncClient) -> None:
        """無効なトークンを検証すると valid=False が返る。"""
        verify_resp = await client.get(
            "/api/v1/punch-devices/verify",
            headers={"X-Punch-Device-Token": "invalid_jwt_token_format"},
        )
        assert verify_resp.status_code == 200
        verify_data = verify_resp.json()
        assert verify_data["valid"] is False
        assert verify_data["name"] is None

    async def test_verify_missing_token(self, client: AsyncClient) -> None:
        """ヘッダー欠落時は valid=False が返る。"""
        verify_resp = await client.get("/api/v1/punch-devices/verify")
        assert verify_resp.status_code == 200
        verify_data = verify_resp.json()
        assert verify_data["valid"] is False
        assert verify_data["name"] is None
