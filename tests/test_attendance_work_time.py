"""打刻時間と勤務出勤/退勤時間の分離および管理者による直接編集機能のテスト。"""

from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.attendance import Attendance
from tests.test_attendance_summary import _create_user, _login


@pytest.mark.asyncio
async def test_work_time_calculation_and_direct_admin_edits(
    session: AsyncSession, client: AsyncClient
) -> None:
    """打刻時間と勤務時間の分離、管理者による直接編集・追加・削除、および自動計算復帰の動作検証。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")
    emp_token = await _login(client, "empuser", "Password123")

    # 1. 管理者による手動追加 (打刻なし、勤務時間のみ)
    resp = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "empuser",
            "work_date": "2026-06-01",
            "work_start": "2026-06-01T09:00:00Z",
            "work_end": "2026-06-01T18:00:00Z",
            "reason": "手動追加テスト",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    att_id = data["id"]
    assert data["check_in"] is None
    assert data["check_out"] is None
    assert data["work_start"] == "2026-06-01T09:00:00Z"
    assert data["work_end"] == "2026-06-01T18:00:00Z"
    assert data["is_manual_work_time"] is True

    # 2. 手動追加レコードの削除（打刻がないので物理削除されるはず）
    resp_del = await client.delete(
        f"/api/v1/attendance/{att_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_del.status_code == 204
    db_res = await session.execute(select(Attendance).where(Attendance.id == att_id))
    assert db_res.scalar_one_or_none() is None

    # 3. 打刻データを持つレコードの作成
    att_with_stamp = Attendance(
        id="stamp_att",
        user_id="empuser",
        work_date=date(2026, 6, 2),
        check_in=datetime(2026, 6, 2, 9, 2, tzinfo=UTC),
        check_out=datetime(2026, 6, 2, 18, 4, tzinfo=UTC),
        source="webusb_nfc",
        is_manual_work_time=False,
    )
    session.add(att_with_stamp)
    await session.commit()

    # 4. 管理者による勤務時間の直接修正 (PATCH)
    resp_patch = await client.patch(
        "/api/v1/attendance/stamp_att",
        json={
            "work_start": "2026-06-02T09:00:00Z",
            "work_end": "2026-06-02T18:00:00Z",
            "reason": "勤務時間を9-18時に修正",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_patch.status_code == 200
    data = resp_patch.json()
    assert data["check_in"] == "2026-06-02T09:02:00Z"  # 打刻は影響を受けない
    assert data["check_out"] == "2026-06-02T18:04:00Z"
    assert data["work_start"] == "2026-06-02T09:00:00Z"
    assert data["work_end"] == "2026-06-02T18:00:00Z"
    assert data["is_manual_work_time"] is True

    # 5. 一般従業員による直接PATCHは制限 (403 FORBIDDEN)
    resp_emp_patch = await client.patch(
        "/api/v1/attendance/stamp_att",
        json={
            "work_start": "2026-06-02T09:00:00Z",
            "work_end": "2026-06-02T18:00:00Z",
            "reason": "一般による修正",
        },
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert resp_emp_patch.status_code == 403

    # 6. 管理者が「削除」を叩いたとき (打刻データがあるので物理削除されず、勤務時間がクリアされる)
    resp_soft_del = await client.delete(
        "/api/v1/attendance/stamp_att",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_soft_del.status_code == 204

    # DB確認：物理削除されず、手動で勤務時間がNULL（削除）になっていること
    db_res2 = await session.execute(select(Attendance).where(Attendance.id == "stamp_att"))
    att2 = db_res2.scalar_one_or_none()
    assert att2 is not None
    assert att2.check_in is not None
    assert att2.work_start is None
    assert att2.work_end is None
    assert att2.is_manual_work_time is True

    # 7. 差し戻し (reset_to_auto) の動作確認
    resp_reset = await client.patch(
        "/api/v1/attendance/stamp_att",
        json={
            "reset_to_auto": True,
            "reason": "自動計算に戻す",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp_reset.status_code == 200
    data_reset = resp_reset.json()
    assert data_reset["is_manual_work_time"] is False
    assert data_reset["work_start"] is None
    assert data_reset["work_end"] is None
