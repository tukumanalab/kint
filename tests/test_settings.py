import pytest
from httpx import AsyncClient

from kint.models.user import User

pytestmark = pytest.mark.asyncio


async def _create_user(session, **kwargs) -> User:
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


async def _login(account_id: str) -> str:
    from kint.routers.auth import _create_access_token

    return _create_access_token(account_id, 1)


async def test_public_settings(client: AsyncClient, session) -> None:
    # 1. 未認証の状態で /settings/public にアクセスし、デフォルト値 "Kint" や表示時間 30秒 が取得できることを確認
    resp = await client.get("/api/v1/settings/public")
    assert resp.status_code == 200
    data = resp.json()
    assert data["site_name"] == "Kint"
    assert data["punch_result_display_seconds"] == 30


async def test_settings_get_and_patch_flow(client: AsyncClient, session) -> None:
    # 1. 一般ユーザーでアクセスして 403 Forbidden になることを確認
    await _create_user(session, id="normal", email="normal@example.com", role="employee")
    normal_token = await _login("normal")
    normal_headers = {"Authorization": f"Bearer {normal_token}"}

    resp = await client.get("/api/v1/settings", headers=normal_headers)
    assert resp.status_code == 403

    resp = await client.patch(
        "/api/v1/settings", headers=normal_headers, json={"site_name": "New Name"}
    )
    assert resp.status_code == 403

    # 2. 管理者ユーザーでログイン
    await _create_user(session, id="admin", email="admin@example.com", role="admin")
    admin_token = await _login("admin")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 3. 管理者が設定を取得し、初期の site_name が "Kint" であることを確認
    resp = await client.get("/api/v1/settings", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["site_name"] == "Kint"
    assert data["punch_result_display_seconds"] == 30
    assert data["monthly_report_time"] == "20:00"
    assert data["login_token_expire_hours"] == 168

    # 4. 管理者が設定を変更
    resp = await client.patch(
        "/api/v1/settings",
        headers=admin_headers,
        json={
            "site_name": "Custom Kint",
            "punch_result_display_seconds": 45,
            "monthly_report_time": "19:30",
            "login_token_expire_hours": 24,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["site_name"] == "Custom Kint"
    assert data["punch_result_display_seconds"] == 45
    assert data["monthly_report_time"] == "19:30"
    assert data["login_token_expire_hours"] == 24

    # 5. 未認証の状態で /settings/public から変更後の値が取得できることを確認
    resp = await client.get("/api/v1/settings/public")
    assert resp.status_code == 200
    data = resp.json()
    assert data["site_name"] == "Custom Kint"
    assert data["punch_result_display_seconds"] == 45

    # 6. 空文字など不正な値で変更しようとしたらバリデーションエラーになることを確認
    resp = await client.patch("/api/v1/settings", headers=admin_headers, json={"site_name": ""})
    assert resp.status_code == 422

    # 範囲外（0秒）の変更でエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings", headers=admin_headers, json={"punch_result_display_seconds": 0}
    )
    assert resp.status_code == 422

    # 範囲外（301秒）の変更でエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings", headers=admin_headers, json={"punch_result_display_seconds": 301}
    )
    assert resp.status_code == 422

    # 不正な monthly_report_time の形式でエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings", headers=admin_headers, json={"monthly_report_time": "24:00"}
    )
    assert resp.status_code == 422

    resp = await client.patch(
        "/api/v1/settings", headers=admin_headers, json={"monthly_report_time": "abc"}
    )
    assert resp.status_code == 422

    # 範囲外（0時間）の変更でエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings", headers=admin_headers, json={"login_token_expire_hours": 0}
    )
    assert resp.status_code == 422

    # 範囲外（8761時間）の変更でエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings", headers=admin_headers, json={"login_token_expire_hours": 8761}
    )
    assert resp.status_code == 422


async def test_jwt_token_expiration_applies_setting(client: AsyncClient, session) -> None:
    from datetime import UTC, datetime

    from jose import jwt

    from kint.config import settings
    from kint.routers.auth import _create_access_token
    from kint.services.settings import SettingsService

    # 管理者ロールでのユーザー作成
    await _create_user(session, id="admin", email="admin@example.com", role="admin")

    # 1. デフォルト値の確認 (168時間 = 7日間)
    service = SettingsService(session)
    expire_hours = await service.get_int("login_token_expire_hours")
    assert expire_hours == 168

    token = _create_access_token("admin", 1, expire_hours=expire_hours)
    payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    exp = payload["exp"]
    expected_duration = 168 * 3600

    now_ts = int(datetime.now(tz=UTC).timestamp())
    assert abs((exp - now_ts) - expected_duration) < 10

    # 2. 設定値を 24時間 に変更
    admin_token = _create_access_token("admin", 1, expire_hours=168)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    resp = await client.patch(
        "/api/v1/settings", headers=admin_headers, json={"login_token_expire_hours": 24}
    )
    assert resp.status_code == 200

    # 3. 変更後の設定値でトークンを生成したときの有効期限の確認 (24時間)
    # セッションキャッシュがあるため、新しいセッションでロードするためにcommit後再ロードされるか確認
    # (FastAPIの Depends(get_db) はリクエストごとに新しいセッションを作るため、テストでも get_int で再取得可能)
    expire_hours_new = await service.get_int("login_token_expire_hours")
    assert expire_hours_new == 24

    token_new = _create_access_token("admin", 1, expire_hours=expire_hours_new)
    payload_new = jwt.decode(token_new, settings.secret_key, algorithms=["HS256"])
    exp_new = payload_new["exp"]
    expected_duration_new = 24 * 3600

    now_ts_new = int(datetime.now(tz=UTC).timestamp())
    assert abs((exp_new - now_ts_new) - expected_duration_new) < 10


async def test_google_signup_disabled_prevents_registration(
    client: AsyncClient, session, monkeypatch
) -> None:
    # 1. Google ID Token 検証をモック
    fake_claims = {
        "sub": "google-unregistered-sub",
        "email": "newuser@example.com",
        "name": "New User",
    }
    monkeypatch.setattr("kint.routers.auth._verify_google_id_token", lambda token: fake_claims)

    # 2. 最初は新規登録がON（デフォルト）であることを確認
    # google_login (ログイン試行) -> 401 USER_NOT_REGISTERED になるはず
    resp = await client.post("/api/v1/auth/google", json={"id_token": "fake-token"})
    assert resp.status_code == 401
    assert resp.json()["code"] == "USER_NOT_REGISTERED"

    # 3. 新規登録無効化（enable_google_signup = False）に設定する
    await _create_user(session, id="admin", email="admin@example.com", role="admin")
    admin_token = await _login("admin")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    resp = await client.patch(
        "/api/v1/settings", headers=admin_headers, json={"enable_google_signup": False}
    )
    assert resp.status_code == 200
    assert resp.json()["enable_google_signup"] is False

    # 4. 新規登録無効状態でログイン試行 -> 403 GOOGLE_SIGNUP_DISABLED になるはず
    resp = await client.post("/api/v1/auth/google", json={"id_token": "fake-token"})
    assert resp.status_code == 403
    assert resp.json()["code"] == "GOOGLE_SIGNUP_DISABLED"
    assert "新規登録は、管理者へお問い合わせください。" in resp.json()["message"]

    # 5. 新規登録無効状態で直接 register (登録) エンドポイントを叩く -> 403 GOOGLE_SIGNUP_DISABLED
    resp = await client.post("/api/v1/auth/register", json={"id_token": "fake-token"})
    assert resp.status_code == 403
    assert resp.json()["code"] == "GOOGLE_SIGNUP_DISABLED"


async def test_google_login_inactive_user_returns_error(
    client: AsyncClient, session, monkeypatch
) -> None:
    # 1. 非アクティブなユーザーをDBに作成
    await _create_user(
        session,
        id="inactive-user",
        email="inactive@example.com",
        role="employee",
        is_active=0,
        google_sub="inactive-google-sub",
    )

    # 2. Google ID Token 検証をモック
    fake_claims = {
        "sub": "inactive-google-sub",
        "email": "inactive@example.com",
        "name": "Inactive User",
    }
    monkeypatch.setattr("kint.routers.auth._verify_google_id_token", lambda token: fake_claims)

    # 3. ログイン試行 -> 401 USER_INACTIVE が返されることを確認
    resp = await client.post("/api/v1/auth/google", json={"id_token": "fake-token"})
    assert resp.status_code == 401
    assert resp.json()["code"] == "USER_INACTIVE"
    assert resp.json()["message"] == "アカウントが無効化されています"
