"""勤怠修正申請と勤怠締め（ロック）処理のテスト。"""

from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.attendance import Attendance, AttendanceChangeLog, AttendanceCorrectionRequest
from tests.test_attendance_summary import _create_user, _login


@pytest.mark.asyncio
async def test_admin_lock_and_unlock(session: AsyncSession, client: AsyncClient) -> None:
    """管理者が勤怠をロックおよびロック解除できることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")
    emp_token = await _login(client, "empuser", "Password123")

    # 1. 従業員はロックできない
    resp = await client.post(
        "/api/v1/attendance/locks",
        json={"year_month": "2023-10"},
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert resp.status_code == 403

    # 2. 管理者はロックできる
    resp = await client.post(
        "/api/v1/attendance/locks",
        json={"year_month": "2023-10"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["year_month"] == "2023-10"
    assert data["locked_by_user_id"] == "adminuser"

    # 3. リスト取得（誰でも可）
    resp = await client.get(
        "/api/v1/attendance/locks",
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["year_month"] == "2023-10"

    # 4. 従業員はロック解除できない
    resp = await client.delete(
        "/api/v1/attendance/locks/2023-10",
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert resp.status_code == 403

    # 5. 管理者はロック解除できる
    resp = await client.delete(
        "/api/v1/attendance/locks/2023-10",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 204

    # 6. リスト取得（空であること）
    resp = await client.get(
        "/api/v1/attendance/locks",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_locked_month_restrictions(session: AsyncSession, client: AsyncClient) -> None:
    """ロックされた月に対する打刻・直接修正が制限されることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="empuser", name="従業員", email="emp@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")
    await _login(client, "empuser", "Password123")

    # 2023-10-15 の勤怠記録を作成
    work_date = date(2023, 10, 15)
    att = Attendance(
        id="att_10_15",
        user_id="empuser",
        work_date=work_date,
        check_in=datetime(2023, 10, 15, 9, 0, tzinfo=UTC),
        check_out=None,
        source="web_user_id",
    )
    session.add(att)
    await session.commit()

    # 月をロックする
    resp = await client.post(
        "/api/v1/attendance/locks",
        json={"year_month": "2023-10"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201

    # 1. 直接修正 (PATCH) がエラーになること
    resp = await client.patch(
        "/api/v1/attendance/att_10_15",
        json={
            "check_in": "2023-10-15T09:10:00Z",
            "check_out": "2023-10-15T18:00:00Z",
            "reason": "修正テスト",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "ATTENDANCE_LOCKED"

    # 2. ロック期間中の新規打刻 (PUNCH) が動作しないこと
    resp = await client.post(
        "/api/v1/punches",
        json={
            "device_id": "test_device",
            "user_id": "empuser",
            "occurred_at": "2023-10-15T18:05:00Z",
            "reason": "打刻テスト",
            "confirm": True,
        },
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "ATTENDANCE_LOCKED"


@pytest.mark.asyncio
async def test_correction_request_lifecycle(session: AsyncSession, client: AsyncClient) -> None:
    """修正申請ライフサイクル（作成、一覧、却下、再申請、承認、ログ保存）をテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(
        session, id="emp1", name="従業員1", email="emp1@example.com", role="employee"
    )
    await _create_user(
        session, id="emp2", name="従業員2", email="emp2@example.com", role="employee"
    )

    admin_token = await _login(client, "adminuser", "Password123")
    emp1_token = await _login(client, "emp1", "Password123")
    emp2_token = await _login(client, "emp2", "Password123")

    # 2023-11-10 の勤怠レコード
    att1 = Attendance(
        id="att_emp1_1110",
        user_id="emp1",
        work_date=date(2023, 11, 10),
        check_in=datetime(2023, 11, 10, 9, 0, tzinfo=UTC),
        check_out=None,
        source="web_user_id",
    )
    session.add(att1)
    await session.commit()

    # 1. 従業員2が従業員1の勤怠を修正申請しようとしたら403エラー
    resp = await client.post(
        "/api/v1/attendance/requests",
        json={
            "attendance_id": "att_emp1_1110",
            "requested_check_in": "2023-11-10T09:15:00Z",
            "requested_check_out": "2023-11-10T18:15:00Z",
            "reason": "電車の遅延",
        },
        headers={"Authorization": f"Bearer {emp2_token}"},
    )
    assert resp.status_code == 403

    # 2. 従業員1が自分の勤怠に申請（正常系）
    resp = await client.post(
        "/api/v1/attendance/requests",
        json={
            "attendance_id": "att_emp1_1110",
            "requested_check_in": "2023-11-10T09:15:00Z",
            "requested_check_out": "2023-11-10T18:15:00Z",
            "reason": "電車の遅延",
        },
        headers={"Authorization": f"Bearer {emp1_token}"},
    )
    assert resp.status_code == 201
    req_data = resp.json()
    assert req_data["status"] == "pending"
    assert req_data["reason"] == "電車の遅延"
    req_id = req_data["id"]

    # 3. 重複申請エラー
    resp = await client.post(
        "/api/v1/attendance/requests",
        json={
            "attendance_id": "att_emp1_1110",
            "requested_check_in": "2023-11-10T09:15:00Z",
            "requested_check_out": "2023-11-10T18:15:00Z",
            "reason": "重複申請テスト",
        },
        headers={"Authorization": f"Bearer {emp1_token}"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "PENDING_REQUEST_EXISTS"

    # 4. 一覧取得 (従業員1は自分の申請だけ見える)
    resp = await client.get(
        "/api/v1/attendance/requests",
        headers={"Authorization": f"Bearer {emp1_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 1

    resp = await client.get(
        "/api/v1/attendance/requests",
        headers={"Authorization": f"Bearer {emp2_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    # 5. 管理者が却下する
    resp = await client.post(
        f"/api/v1/attendance/requests/{req_id}/reject",
        json={"approval_comment": "証拠を提出してください"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
    assert resp.json()["approval_comment"] == "証拠を提出してください"

    # 6. 却下されたので、別の申請を出す （同じ attendance_id に pending が無いので作成できる）
    resp = await client.post(
        "/api/v1/attendance/requests",
        json={
            "attendance_id": "att_emp1_1110",
            "requested_check_in": "2023-11-10T09:00:00Z",
            "requested_check_out": "2023-11-10T18:00:00Z",
            "reason": "証拠添付で再申請",
        },
        headers={"Authorization": f"Bearer {emp1_token}"},
    )
    assert resp.status_code == 201
    new_req_id = resp.json()["id"]

    # 7. 管理者が承認する
    resp = await client.post(
        f"/api/v1/attendance/requests/{new_req_id}/approve",
        json={"approval_comment": "承認しました"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"

    # 既存の Attendance レコードが更新されているか検証
    db_result = await session.execute(select(Attendance).where(Attendance.id == "att_emp1_1110"))
    updated_att = db_result.scalar_one_or_none()
    assert updated_att is not None
    assert updated_att.check_in.strftime("%Y-%m-%dT%H:%M:%SZ") == "2023-11-10T09:00:00Z"
    assert updated_att.check_out.strftime("%Y-%m-%dT%H:%M:%SZ") == "2023-11-10T18:00:00Z"

    # 監査ログが保存されていることを検証
    log_result = await session.execute(
        select(AttendanceChangeLog).where(AttendanceChangeLog.attendance_id == "att_emp1_1110")
    )
    logs = list(log_result.scalars().all())
    assert len(logs) == 1
    assert logs[0].actor_user_id == "adminuser"
    assert logs[0].reason == "証拠添付で再申請 (承認時コメント: 承認しました)"


@pytest.mark.asyncio
async def test_lock_automatically_rejects_pending_requests(
    session: AsyncSession, client: AsyncClient
) -> None:
    """年月をロックした時に、その月の承認待ち(pending)申請が自動的に却下されることをテストする。"""
    await _create_user(
        session, id="adminuser", name="管理者", email="admin@example.com", role="admin"
    )
    await _create_user(session, id="emp", name="従業員", email="emp@example.com", role="employee")

    admin_token = await _login(client, "adminuser", "Password123")
    emp_token = await _login(client, "emp", "Password123")

    att = Attendance(
        id="att_target",
        user_id="emp",
        work_date=date(2023, 10, 10),
        check_in=datetime(2023, 10, 10, 9, 0, tzinfo=UTC),
        check_out=None,
        source="web_user_id",
    )
    session.add(att)
    await session.commit()

    # 従業員が申請を作成
    resp = await client.post(
        "/api/v1/attendance/requests",
        json={
            "attendance_id": "att_target",
            "requested_check_in": "2023-10-10T09:00:00Z",
            "requested_check_out": "2023-10-10T18:00:00Z",
            "reason": "ロックで却下されるべき申請",
        },
        headers={"Authorization": f"Bearer {emp_token}"},
    )
    assert resp.status_code == 201
    req_id = resp.json()["id"]

    # 2023-10 をロック
    resp = await client.post(
        "/api/v1/attendance/locks",
        json={"year_month": "2023-10"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 201

    # 申請が自動的に却下されているか検証
    db_res = await session.execute(
        select(AttendanceCorrectionRequest).where(AttendanceCorrectionRequest.id == req_id)
    )
    req = db_res.scalar_one_or_none()
    assert req is not None
    assert req.status == "rejected"
    assert (
        "当月の締め処理が完了したため、システムにより自動的に却下されました。"
        in req.approval_comment
    )


@pytest.mark.asyncio
async def test_overlapping_attendance_not_allowed(
    session: AsyncSession, client: AsyncClient
) -> None:
    """重複する勤務時間の申請および直接編集がブロックされることをテストする。"""
    await _create_user(
        session, id="overlap_user", name="重複太郎", email="overlap@example.com", role="employee"
    )
    await _create_user(
        session,
        id="overlap_admin",
        name="重複管理者",
        email="overlap_admin@example.com",
        role="admin",
    )

    user_token = await _login(client, "overlap_user", "Password123")
    admin_token = await _login(client, "overlap_admin", "Password123")

    # 1. すでに存在する勤務帯: 15:29 - 15:35
    att1 = Attendance(
        id="att_overlap_1",
        user_id="overlap_user",
        work_date=date(2026, 5, 30),
        check_in=datetime(2026, 5, 30, 15, 29, tzinfo=UTC),
        check_out=datetime(2026, 5, 30, 15, 35, tzinfo=UTC),
        source="web_user_id",
    )
    # 2. 別の時間帯: 16:00 - 17:00
    att2 = Attendance(
        id="att_overlap_2",
        user_id="overlap_user",
        work_date=date(2026, 5, 30),
        check_in=datetime(2026, 5, 30, 16, 0, tzinfo=UTC),
        check_out=datetime(2026, 5, 30, 17, 0, tzinfo=UTC),
        source="web_user_id",
    )
    session.add(att1)
    session.add(att2)
    await session.commit()

    # (A) 申請時に、もう一つの勤務時間 (15:29-15:35) と重なる
    # 15:31-15:33 に修正申請しようとするとエラー
    resp = await client.post(
        "/api/v1/attendance/requests",
        json={
            "attendance_id": "att_overlap_2",
            "requested_check_in": "2026-05-30T15:31:00Z",
            "requested_check_out": "2026-05-30T15:33:00Z",
            "reason": "時間重複申請",
        },
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert resp.status_code == 400
    data = resp.json()
    assert data["code"] == "ATTENDANCE_OVERLAP"
    assert "指定された時間帯は、別の勤怠記録" in data["message"]

    # (B) 管理者が直接編集で、もう一つの勤務時間と重複させようとした場合もエラー
    resp = await client.patch(
        "/api/v1/attendance/att_overlap_2",
        json={
            "check_in": "2026-05-30T15:31:00Z",
            "check_out": "2026-05-30T15:33:00Z",
            "reason": "直接重複編集",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 400
    data = resp.json()
    assert data["code"] == "ATTENDANCE_OVERLAP"
