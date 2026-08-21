"""月次勤務サマリー コメント（管理者共有メモ）API のテスト。"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_attendance_summary import _create_user, _login


async def _setup_admin_and_employee(session: AsyncSession):
    """テスト用の管理者2名・従業員1名を作成する。"""
    admin1 = await _create_user(
        session, id="admin1", name="管理者1", email="admin1@example.com", role="admin"
    )
    admin2 = await _create_user(
        session, id="admin2", name="管理者2", email="admin2@example.com", role="admin"
    )
    emp = await _create_user(
        session, id="emp1", name="従業員1", email="emp1@example.com", role="employee"
    )
    return admin1, admin2, emp


@pytest.mark.asyncio
async def test_get_unregistered_month_returns_empty(
    session: AsyncSession, client: AsyncClient
) -> None:
    """未登録の年月を GET すると 200 で空のコメントが返る。"""
    await _setup_admin_and_employee(session)
    admin_token = await _login(client, "admin1", "Password123")

    resp = await client.get(
        "/api/v1/attendance/summary/comment",
        params={"year_month": "2026-07"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["year_month"] == "2026-07"
    assert data["body"] == ""
    assert data["updated_at"] is None
    assert data["updated_by_user_id"] is None
    assert data["updated_by_name"] is None


@pytest.mark.asyncio
async def test_admin_put_creates_comment(session: AsyncSession, client: AsyncClient) -> None:
    """管理者が PUT するとコメントが作成され、GET で内容が確認できる。"""
    await _setup_admin_and_employee(session)
    admin_token = await _login(client, "admin1", "Password123")

    put_resp = await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "5月分の付け替えあり"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert put_resp.status_code == 200
    put_data = put_resp.json()
    assert put_data["body"] == "5月分の付け替えあり"
    assert put_data["updated_by_user_id"] == "admin1"
    assert put_data["updated_by_name"] == "管理者1"
    assert put_data["updated_at"] is not None

    get_resp = await client.get(
        "/api/v1/attendance/summary/comment",
        params={"year_month": "2026-07"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert get_data["body"] == "5月分の付け替えあり"
    assert get_data["updated_by_user_id"] == "admin1"
    assert get_data["updated_by_name"] == "管理者1"
    assert get_data["updated_at"] is not None


@pytest.mark.asyncio
async def test_another_admin_can_overwrite_comment(
    session: AsyncSession, client: AsyncClient
) -> None:
    """別の管理者が PUT すると上書きされ、最終更新者が変わる。"""
    await _setup_admin_and_employee(session)
    admin1_token = await _login(client, "admin1", "Password123")
    admin2_token = await _login(client, "admin2", "Password123")

    await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "最初のメモ"},
        headers={"Authorization": f"Bearer {admin1_token}"},
    )

    resp = await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "admin2による上書き"},
        headers={"Authorization": f"Bearer {admin2_token}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["body"] == "admin2による上書き"
    assert data["updated_by_user_id"] == "admin2"
    assert data["updated_by_name"] == "管理者2"


@pytest.mark.asyncio
async def test_blank_body_deletes_comment(session: AsyncSession, client: AsyncClient) -> None:
    """空白のみの本文で PUT すると行が削除され、GET が空レスポンスになる。"""
    await _setup_admin_and_employee(session)
    admin_token = await _login(client, "admin1", "Password123")

    await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "削除予定のメモ"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    resp = await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "   "},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["body"] == ""
    assert data["updated_by_user_id"] is None

    get_resp = await client.get(
        "/api/v1/attendance/summary/comment",
        params={"year_month": "2026-07"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    get_data = get_resp.json()
    assert get_data["body"] == ""
    assert get_data["updated_at"] is None


@pytest.mark.asyncio
async def test_employee_forbidden(session: AsyncSession, client: AsyncClient) -> None:
    """従業員は GET/PUT ともに 403 になる。"""
    await _setup_admin_and_employee(session)
    emp_token = await _login(client, "emp1", "Password123")

    get_resp = await client.get(
        "/api/v1/attendance/summary/comment",
        params={"year_month": "2026-07"},
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert get_resp.status_code == 403

    put_resp = await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "従業員による書き込み"},
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert put_resp.status_code == 403


@pytest.mark.asyncio
async def test_validation_errors(session: AsyncSession, client: AsyncClient) -> None:
    """本文が2001文字、または year_month の形式不正の場合は 422 になる。"""
    await _setup_admin_and_employee(session)
    admin_token = await _login(client, "admin1", "Password123")

    too_long_resp = await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "a" * 2001},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert too_long_resp.status_code == 422

    bad_year_month_put = await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-7", "body": "テスト"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert bad_year_month_put.status_code == 422

    bad_year_month_get = await client.get(
        "/api/v1/attendance/summary/comment",
        params={"year_month": "202607"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert bad_year_month_get.status_code == 422


@pytest.mark.asyncio
async def test_comment_is_isolated_per_month(session: AsyncSession, client: AsyncClient) -> None:
    """別月への PUT が他月のコメントに影響しないこと。"""
    await _setup_admin_and_employee(session)
    admin_token = await _login(client, "admin1", "Password123")

    await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "7月のメモ"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-08", "body": "8月のメモ"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    resp_07 = await client.get(
        "/api/v1/attendance/summary/comment",
        params={"year_month": "2026-07"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    resp_08 = await client.get(
        "/api/v1/attendance/summary/comment",
        params={"year_month": "2026-08"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp_07.json()["body"] == "7月のメモ"
    assert resp_08.json()["body"] == "8月のメモ"


@pytest.mark.asyncio
async def test_put_succeeds_while_month_locked(session: AsyncSession, client: AsyncClient) -> None:
    """月ロック中でもコメントの PUT が成功すること。"""
    await _setup_admin_and_employee(session)
    admin_token = await _login(client, "admin1", "Password123")

    lock_resp = await client.post(
        "/api/v1/attendance/locks",
        json={"year_month": "2026-07"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert lock_resp.status_code == 201

    resp = await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "ロック中でも保存できるメモ"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 200
    assert resp.json()["body"] == "ロック中でも保存できるメモ"


@pytest.mark.asyncio
async def test_hard_delete_updater_clears_reference_but_keeps_body(
    session: AsyncSession, client: AsyncClient
) -> None:
    """更新者を hard_delete した後、GET で updated_by_* が None かつ本文は残ること。"""
    await _setup_admin_and_employee(session)
    # 3人目の管理者を作成し、これを削除対象にする（最後の管理者制約を回避するため）
    await _create_user(
        session, id="admin3", name="管理者3", email="admin3@example.com", role="admin"
    )
    admin1_token = await _login(client, "admin1", "Password123")
    admin3_token = await _login(client, "admin3", "Password123")

    await client.put(
        "/api/v1/attendance/summary/comment",
        json={"year_month": "2026-07", "body": "admin3が更新したメモ"},
        headers={"Authorization": f"Bearer {admin3_token}"},
    )

    del_resp = await client.delete(
        "/api/v1/users/admin3?hard=true",
        headers={"Authorization": f"Bearer {admin1_token}"},
    )
    assert del_resp.status_code in (200, 204)

    get_resp = await client.get(
        "/api/v1/attendance/summary/comment",
        params={"year_month": "2026-07"},
        headers={"Authorization": f"Bearer {admin1_token}"},
    )
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["body"] == "admin3が更新したメモ"
    assert data["updated_by_user_id"] is None
    assert data["updated_by_name"] is None
