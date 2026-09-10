"""月次勤怠変更履歴 API のテスト。"""

from datetime import date, datetime
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_attendance_summary import _create_user, _login


@pytest.mark.asyncio
async def test_get_monthly_history(client: AsyncClient, session: AsyncSession) -> None:
    # ユーザーを作成
    admin = await _create_user(
        session, id="admin_hist", name="admin_hist", email="admin_hist@example.com", role="admin"
    )
    emp1 = await _create_user(
        session, id="emp1_hist", name="emp1_hist", email="emp1_hist@example.com", role="employee"
    )
    emp2 = await _create_user(
        session, id="emp2_hist", name="emp2_hist", email="emp2_hist@example.com", role="employee"
    )

    admin_headers = {"Authorization": f"Bearer {await _login(client, 'admin_hist')}"}
    emp1_headers = {"Authorization": f"Bearer {await _login(client, 'emp1_hist')}"}

    target_month = "2026-08"

    # 管理者が emp1 と emp2 の勤怠を作成・修正して履歴を作る
    # 1) emp1 の 2026-08-10 勤怠レコードを patch
    create_res1 = await client.post(
        "/api/v1/attendance",
        headers=admin_headers,
        json={
            "user_id": emp1.id,
            "work_date": "2026-08-10",
            "work_start": "2026-08-10T09:00:00",
            "work_end": "2026-08-10T18:00:00",
            "reason": "初期登録",
        },
    )
    assert create_res1.status_code == 201
    att1_id = create_res1.json()["id"]

    patch_res1 = await client.patch(
        f"/api/v1/attendance/{att1_id}",
        headers=admin_headers,
        json={
            "work_start": "2026-08-10T08:30:00",
            "work_end": "2026-08-10T18:00:00",
            "reason": "早出修正",
        },
    )
    assert patch_res1.status_code == 200

    # 2) emp2 の 2026-08-11 勤怠レコードを patch
    create_res2 = await client.post(
        "/api/v1/attendance",
        headers=admin_headers,
        json={
            "user_id": emp2.id,
            "work_date": "2026-08-11",
            "work_start": "2026-08-11T09:00:00",
            "work_end": "2026-08-11T17:00:00",
            "reason": "初期登録",
        },
    )
    assert create_res2.status_code == 201

    # 3) 管理者が全員分のログを取得
    res_all = await client.get(
        f"/api/v1/attendance/monthly-history?year_month={target_month}",
        headers=admin_headers,
    )
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert data_all["total"] >= 2
    target_users = {item["target_user_id"] for item in data_all["items"]}
    assert emp1.id in target_users
    assert emp2.id in target_users

    # 4) 管理者が emp1 のみ絞り込み指定して取得
    res_emp1 = await client.get(
        f"/api/v1/attendance/monthly-history?year_month={target_month}&user_id={emp1.id}",
        headers=admin_headers,
    )
    assert res_emp1.status_code == 200
    data_emp1 = res_emp1.json()
    for item in data_emp1["items"]:
        assert item["target_user_id"] == emp1.id

    # 5) 一般従業員 emp1 が取得（user_id 未指定または emp2 指定でも自分のみ返る）
    res_emp1_self = await client.get(
        f"/api/v1/attendance/monthly-history?year_month={target_month}&user_id={emp2.id}",
        headers=emp1_headers,
    )
    assert res_emp1_self.status_code == 200
    data_emp1_self = res_emp1_self.json()
    for item in data_emp1_self["items"]:
        assert item["target_user_id"] == emp1.id
