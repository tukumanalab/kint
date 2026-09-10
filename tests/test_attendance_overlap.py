"""勤怠重複エラーメッセージ・日跨ぎ・長時間未退勤時の打刻挙動テスト。"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.attendance import Attendance
from tests.test_attendance_summary import _create_user, _login


@pytest.mark.asyncio
async def test_overlap_error_message_with_cross_day(
    session: AsyncSession, client: AsyncClient
) -> None:
    """日跨ぎ勤務と重複した際、エラーメッセージに退勤日の年月日が含まれることをテストする。"""
    await _create_user(
        session, id="admin1", name="管理者", email="admin1@example.com", role="admin"
    )
    await _create_user(
        session, id="emp1", name="従業員1", email="emp1@example.com", role="employee"
    )

    admin_token = await _login(client, "admin1", "Password123")

    # 1. 2026-08-31 13:00 (JST) 〜 2026-09-01 10:00 (JST) の日跨ぎ勤怠を登録
    # UTC: 2026-08-31 04:00:00Z 〜 2026-09-01 01:00:00Z
    resp1 = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "emp1",
            "work_date": "2026-08-31",
            "work_start": "2026-08-31T04:00:00Z",
            "work_end": "2026-09-01T01:00:00Z",
            "reason": "日跨ぎ勤務テスト",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp1.status_code == 201

    # 2. 翌日 2026-09-01 08:00 (JST) 〜 12:00 (JST) を追加しようとして重複
    # UTC: 2026-08-31 23:00:00Z 〜 2026-09-01 03:00:00Z
    resp2 = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "emp1",
            "work_date": "2026-09-01",
            "work_start": "2026-08-31T23:00:00Z",
            "work_end": "2026-09-01T03:00:00Z",
            "reason": "重複勤怠テスト",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp2.status_code == 400
    data2 = resp2.json()
    assert data2["code"] == "ATTENDANCE_OVERLAP"
    # 退勤日（2026-09-01）がメッセージに含まれていることを確認
    assert "2026-08-31 13:00:00 〜 2026-09-01 10:00:00" in data2["message"]


@pytest.mark.asyncio
async def test_attendance_range_too_large(session: AsyncSession, client: AsyncClient) -> None:
    """7日を超える期間の勤怠登録が ATTENDANCE_RANGE_TOO_LARGE エラーになることをテストする。"""
    await _create_user(
        session, id="admin2", name="管理者2", email="admin2@example.com", role="admin"
    )
    await _create_user(
        session, id="emp2", name="従業員2", email="emp2@example.com", role="employee"
    )

    admin_token = await _login(client, "admin2", "Password123")

    # 8日間の勤怠を追加しようとする
    resp = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "emp2",
            "work_date": "2026-08-31",
            "work_start": "2026-08-31T04:00:00Z",
            "work_end": "2026-09-08T04:00:00Z",
            "reason": "8日間の異常勤怠",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400
    data = resp.json()
    assert data["code"] == "ATTENDANCE_RANGE_TOO_LARGE"


@pytest.mark.asyncio
async def test_stale_open_attendance_not_linked_to_punch(
    session: AsyncSession, client: AsyncClient
) -> None:
    """24時間以上経過した未退勤レコードが存在する場合、次の打刻が新しい出勤になることをテストする。"""
    await _create_user(
        session, id="emp3", name="従業員3", email="emp3@example.com", role="employee"
    )

    # 1. 2日前の出勤レコード（未退勤）をDBに直接作成
    past_in = datetime.now(tz=UTC) - timedelta(days=2)
    past_att = Attendance(
        id="past-att-id",
        user_id="emp3",
        work_date=past_in.date(),
        check_in=past_in,
        check_out=None,
        source="web_user_id",
    )
    session.add(past_att)
    await session.commit()

    # 2. 現在時刻で打刻を実行
    now = datetime.now(tz=UTC)
    punch_resp = await client.post(
        "/api/v1/punches",
        json={
            "user_id": "emp3",
            "device_id": "web-browser",
            "occurred_at": now.isoformat(),
            "reason": "カード忘れ打刻",
            "confirm": True,
        },
    )
    assert punch_resp.status_code == 200
    data = punch_resp.json()
    # 退勤ではなく新規出勤（check_in）になっていることを確認
    assert data["action"] == "check_in"
    assert data["attendance_id"] != "past-att-id"

    # DB内のレコード確認: 過去レコードは未退勤のまま残っている
    result = await session.execute(select(Attendance).where(Attendance.id == "past-att-id"))
    old_att = result.scalar_one_or_none()
    assert old_att is not None
    assert old_att.check_out is None
