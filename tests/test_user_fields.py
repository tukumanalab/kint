import pytest
from httpx import AsyncClient
from sqlalchemy import select

from kint.models.user import User
from kint.routers.auth import _create_access_token


@pytest.mark.asyncio
async def test_user_create_and_patch_with_new_fields(client: AsyncClient, session) -> None:
    admin = User(
        id="admin@example.com",
        name="管理者",
        full_name="Test Admin",
        email="admin@example.com",
        role="admin",
        is_active=1,
        token_version=1,
    )
    session.add(admin)
    await session.commit()

    token = _create_access_token(admin.id, admin.token_version)
    headers = {"Authorization": f"Bearer {token}"}

    create_payload = {
        "id": "employee1@example.com",
        "name": "emp1",
        "full_name": "青山 太郎",
        "name_kana": "アオヤマ タロウ",
        "department": "情報システム学科",
        "worker_id": "15123001",
        "email": "employee1@example.com",
        "role": "employee",
    }
    resp = await client.post("/api/v1/users", json=create_payload, headers=headers)
    assert resp.status_code == 201, resp.text

    data = resp.json()
    assert data["name_kana"] == "アオヤマ タロウ"
    assert data["department"] == "情報システム学科"
    assert data["worker_id"] == "15123001"

    patch_payload = {
        "name_kana": "アオヤマ ジロウ",
        "department": "メディア社会学科",
        "worker_id": "15123999",
    }
    resp = await client.patch(f"/api/v1/users/{data['id']}", json=patch_payload, headers=headers)
    assert resp.status_code == 200, resp.text

    patched_data = resp.json()
    assert patched_data["name_kana"] == "アオヤマ ジロウ"
    assert patched_data["department"] == "メディア社会学科"
    assert patched_data["worker_id"] == "15123999"

    user_in_db = (
        await session.execute(select(User).where(User.id == "employee1@example.com"))
    ).scalar_one()
    assert user_in_db.name_kana == "アオヤマ ジロウ"
    assert user_in_db.department == "メディア社会学科"
    assert user_in_db.worker_id == "15123999"
