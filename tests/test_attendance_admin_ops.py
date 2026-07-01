"""管理者による勤怠記録追加・削除機能のテスト。"""

from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.attendance import Attendance, AttendanceChangeLog
from tests.test_attendance_summary import _create_user, _login


@pytest.mark.asyncio
async def test_admin_create_attendance_success(session: AsyncSession, client: AsyncClient) -> None:
    """管理者が勤怠を正常に追加できることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")

    work_date = date(2026, 6, 1)
    work_start = datetime(2026, 6, 1, 9, 0, tzinfo=UTC)
    work_end = datetime(2026, 6, 1, 18, 0, tzinfo=UTC)

    # 管理者が従業員の勤怠を追加
    resp = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "empuser",
            "work_date": work_date.isoformat(),
            "work_start": work_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "work_end": work_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "reason": "手動追加テスト",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["user_id"] == "empuser"
    assert data["work_date"] == work_date.isoformat()
    assert data["source"] == "admin_manual"
    assert data["updated_reason"] == "手動追加テスト"

    # DBにレコードが存在し、チェンジログが記録されているか確認
    att_id = data["id"]
    db_result = await session.execute(select(Attendance).where(Attendance.id == att_id))
    att = db_result.scalar_one_or_none()
    assert att is not None
    # 勤務時間追加モードでも check_in/check_out は work_start/work_end と同値がセットされる
    assert att.check_in.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T09:00:00Z"
    assert att.check_out.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T18:00:00Z"
    assert att.work_start.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T09:00:00Z"
    assert att.work_end.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T18:00:00Z"

    log_result = await session.execute(
        select(AttendanceChangeLog).where(AttendanceChangeLog.attendance_id == att_id)
    )
    logs = list(log_result.scalars().all())
    assert len(logs) == 1
    assert logs[0].actor_user_id == "adminuser"
    assert logs[0].before_work_start is None
    assert logs[0].before_work_end is None
    assert logs[0].after_work_start.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T09:00:00Z"
    assert logs[0].after_work_end.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T18:00:00Z"
    assert logs[0].reason == "手動追加テスト"


@pytest.mark.asyncio
async def test_employee_cannot_create_attendance(
    session: AsyncSession, client: AsyncClient
) -> None:
    """一般従業員は勤怠を追加できない（403エラー）ことをテストする。"""
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    emp_token = await _login(client, "empuser", "Password123")

    # 従業員が勤怠の追加を試みる
    resp = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "empuser",
            "work_date": "2026-06-01",
            "check_in": "2026-06-01T09:00:00Z",
            "check_out": "2026-06-01T18:00:00Z",
            "reason": "不正な追加試行",
        },
        headers={"Authorization": f"Bearer {emp_token}"},
    )

    assert resp.status_code == 403
    assert resp.json()["code"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_create_attendance_overlap_restriction(
    session: AsyncSession, client: AsyncClient
) -> None:
    """重複する時間帯の勤怠追加がブロックされることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")

    # 既存レコード作成
    att = Attendance(
        id="existing_att",
        user_id="empuser",
        work_date=date(2026, 6, 1),
        check_in=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
        check_out=datetime(2026, 6, 1, 12, 0, tzinfo=UTC),
        source="web_user_id",
    )
    session.add(att)
    await session.commit()

    # 重複する時間帯（10:00〜14:00）で追加を試みる
    resp = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "empuser",
            "work_date": "2026-06-01",
            "work_start": "2026-06-01T10:00:00Z",
            "work_end": "2026-06-01T14:00:00Z",
            "reason": "重複追加",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 400
    assert resp.json()["code"] == "ATTENDANCE_OVERLAP"


@pytest.mark.asyncio
async def test_create_attendance_locked_restriction(
    session: AsyncSession, client: AsyncClient
) -> None:
    """ロックされた期間に対する勤怠追加がブロックされることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")

    # 2026-06 をロックする
    resp = await client.post(
        "/api/v1/attendance/locks",
        json={"year_month": "2026-06"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201

    # ロックされた月の勤怠追加を試みる
    resp = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "empuser",
            "work_date": "2026-06-15",
            "work_start": "2026-06-15T09:00:00Z",
            "work_end": "2026-06-15T18:00:00Z",
            "reason": "ロック期間追加",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 400
    assert resp.json()["code"] == "ATTENDANCE_LOCKED"


@pytest.mark.asyncio
async def test_admin_delete_attendance_success(session: AsyncSession, client: AsyncClient) -> None:
    """管理者が勤怠を正常に削除できることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")

    # レコードとチェンジログをあらかじめ作成
    att = Attendance(
        id="att_to_delete",
        user_id="empuser",
        work_date=date(2026, 6, 2),
        check_in=None,
        check_out=None,
        work_start=datetime(2026, 6, 2, 9, 0, tzinfo=UTC),
        work_end=datetime(2026, 6, 2, 18, 0, tzinfo=UTC),
        is_manual_work_time=True,
        source="admin_manual",
    )
    session.add(att)
    await session.flush()

    log = AttendanceChangeLog(
        id="log_to_delete",
        attendance_id="att_to_delete",
        actor_user_id="adminuser",
        actor_role="admin",
        before_check_in=None,
        before_check_out=None,
        after_check_in=None,
        after_check_out=None,
        before_work_start=None,
        before_work_end=None,
        after_work_start=att.work_start,
        after_work_end=att.work_end,
        reason="手動追加",
    )
    session.add(log)
    await session.commit()

    # 管理者が勤怠レコードを削除する
    resp = await client.delete(
        "/api/v1/attendance/att_to_delete",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 204

    # DBからレコードとチェンジログが消えていることを確認
    db_result = await session.execute(select(Attendance).where(Attendance.id == "att_to_delete"))
    assert db_result.scalar_one_or_none() is None

    log_result = await session.execute(
        select(AttendanceChangeLog).where(AttendanceChangeLog.id == "log_to_delete")
    )
    assert log_result.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_employee_cannot_delete_attendance(
    session: AsyncSession, client: AsyncClient
) -> None:
    """一般従業員は勤怠を削除できないことをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    emp_token = await _login(client, "empuser", "Password123")

    att = Attendance(
        id="att_test",
        user_id="empuser",
        work_date=date(2026, 6, 2),
        check_in=datetime(2026, 6, 2, 9, 0, tzinfo=UTC),
        check_out=None,
        source="web_user_id",
    )
    session.add(att)
    await session.commit()

    # 従業員が削除を試みる
    resp = await client.delete(
        "/api/v1/attendance/att_test",
        headers={"Authorization": f"Bearer {emp_token}"},
    )

    assert resp.status_code == 403
    assert resp.json()["code"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_delete_attendance_locked_restriction(
    session: AsyncSession, client: AsyncClient
) -> None:
    """ロックされた期間に対する勤怠削除がブロックされることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")

    # ロック対象月の勤怠レコード
    att = Attendance(
        id="att_locked_del",
        user_id="empuser",
        work_date=date(2026, 6, 2),
        check_in=datetime(2026, 6, 2, 9, 0, tzinfo=UTC),
        check_out=None,
        source="web_user_id",
    )
    session.add(att)
    await session.commit()

    # 月をロック
    resp = await client.post(
        "/api/v1/attendance/locks",
        json={"year_month": "2026-06"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201

    # 削除を試みる
    resp = await client.delete(
        "/api/v1/attendance/att_locked_del",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 400
    assert resp.json()["code"] == "ATTENDANCE_LOCKED"


@pytest.mark.asyncio
async def test_admin_create_attendance_punch_mode(
    session: AsyncSession, client: AsyncClient
) -> None:
    """管理者が打刻追加モードで勤怠レコードを正常に追加できることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")

    work_date = date(2026, 6, 1)
    check_in = datetime(2026, 6, 1, 9, 3, tzinfo=UTC)
    check_out = datetime(2026, 6, 1, 18, 5, tzinfo=UTC)

    resp = await client.post(
        "/api/v1/attendance",
        json={
            "user_id": "empuser",
            "work_date": work_date.isoformat(),
            "check_in": check_in.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "check_out": check_out.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "edit_mode": "punch",
            "reason": "打刻追加テスト",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["user_id"] == "empuser"
    assert data["work_date"] == work_date.isoformat()
    assert data["source"] == "admin_manual"

    att_id = data["id"]
    db_result = await session.execute(select(Attendance).where(Attendance.id == att_id))
    att = db_result.scalar_one_or_none()
    assert att is not None
    assert att.check_in.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T09:03:00Z"
    assert att.check_out.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T18:05:00Z"
    assert att.work_start is None
    assert att.work_end is None
    assert att.is_manual_work_time is False

    log_result = await session.execute(
        select(AttendanceChangeLog).where(AttendanceChangeLog.attendance_id == att_id)
    )
    logs = list(log_result.scalars().all())
    assert len(logs) == 1
    assert logs[0].after_check_in.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T09:03:00Z"
    assert logs[0].after_check_out.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T18:05:00Z"


@pytest.mark.asyncio
async def test_admin_patch_attendance_punch_mode(
    session: AsyncSession, client: AsyncClient
) -> None:
    """管理者が打刻修正モードで既存勤怠レコードを正常に修正できることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")

    att = Attendance(
        id="att_patch_punch",
        user_id="empuser",
        work_date=date(2026, 6, 1),
        check_in=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
        check_out=datetime(2026, 6, 1, 18, 0, tzinfo=UTC),
        source="webusb_nfc",
    )
    session.add(att)
    await session.commit()

    new_check_in = datetime(2026, 6, 1, 9, 15, tzinfo=UTC)
    new_check_out = datetime(2026, 6, 1, 18, 20, tzinfo=UTC)

    resp = await client.patch(
        "/api/v1/attendance/att_patch_punch",
        json={
            "check_in": new_check_in.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "check_out": new_check_out.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "edit_mode": "punch",
            "reason": "打刻修正テスト",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["check_in"].endswith("09:15:00Z")
    assert data["check_out"].endswith("18:20:00Z")
    assert data["is_manual_work_time"] is False

    db_result = await session.execute(select(Attendance).where(Attendance.id == "att_patch_punch"))
    db_att = db_result.scalar_one_or_none()
    assert db_att is not None
    assert db_att.check_in == new_check_in
    assert db_att.check_out == new_check_out
    assert db_att.work_start is None
    assert db_att.work_end is None
    assert db_att.is_manual_work_time is False

    log_result = await session.execute(
        select(AttendanceChangeLog)
        .where(AttendanceChangeLog.attendance_id == "att_patch_punch")
        .order_by(AttendanceChangeLog.changed_at.desc())
    )
    logs = list(log_result.scalars().all())
    assert len(logs) == 1
    assert logs[0].before_check_in.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T09:00:00Z"
    assert logs[0].after_check_in.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-06-01T09:15:00Z"
