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
        "/api/v1/settings",
        headers=normal_headers,
        json={"site_name": "New Name"}
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

    # 4. 管理者が site_name を "Custom Kint"、表示時間を 45 秒 、通知時刻を "19:30" に変更
    resp = await client.patch(
        "/api/v1/settings",
        headers=admin_headers,
        json={"site_name": "Custom Kint", "punch_result_display_seconds": 45, "monthly_report_time": "19:30"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["site_name"] == "Custom Kint"
    assert data["punch_result_display_seconds"] == 45
    assert data["monthly_report_time"] == "19:30"

    # 5. 未認証の状態で /settings/public から変更後の値が取得できることを確認
    resp = await client.get("/api/v1/settings/public")
    assert resp.status_code == 200
    data = resp.json()
    assert data["site_name"] == "Custom Kint"
    assert data["punch_result_display_seconds"] == 45

    # 6. 空文字など不正な値で変更しようとしたらバリデーションエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings",
        headers=admin_headers,
        json={"site_name": ""}
    )
    assert resp.status_code == 422

    # 範囲外（0秒）の変更でエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings",
        headers=admin_headers,
        json={"punch_result_display_seconds": 0}
    )
    assert resp.status_code == 422

    # 範囲外（301秒）の変更でエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings",
        headers=admin_headers,
        json={"punch_result_display_seconds": 301}
    )
    assert resp.status_code == 422

    # 不正な monthly_report_time の形式でエラーになることを確認
    resp = await client.patch(
        "/api/v1/settings",
        headers=admin_headers,
        json={"monthly_report_time": "24:00"}
    )
    assert resp.status_code == 422

    resp = await client.patch(
        "/api/v1/settings",
        headers=admin_headers,
        json={"monthly_report_time": "abc"}
    )
    assert resp.status_code == 422

