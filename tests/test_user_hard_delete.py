import uuid
from datetime import date, datetime, UTC

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from kint.models.attendance import (
    Attendance,
    AttendanceChangeLog,
    AttendanceCorrectionRequest,
    AttendanceLock,
)
from kint.models.card import Card
from kint.models.email_verification import EmailVerificationRequest
from kint.models.shift import Shift
from kint.models.user import User
from kint.models.user_profile_change_log import UserProfileChangeLog


async def _create_user(session, **kwargs) -> User:
    """テスト用ユーザーを DB に作成する。"""
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


async def _login(account_id: str = "testadmin") -> str:
    """JWTトークンを直接生成して返す。"""
    from kint.routers.auth import _create_access_token

    return _create_access_token(account_id, 1)


class TestUserHardDelete:
    @pytest.mark.asyncio
    async def test_hard_delete_success(self, client: AsyncClient, session) -> None:
        """物理削除(hard=true)が正常に動作し、関連する全レコードがクリーンアップされること。"""
        # 管理者作成（実行者） & 一般ユーザー作成（削除対象）
        admin = await _create_user(
            session, id="adminuser", email="admin@example.com", role="admin"
        )
        target = await _create_user(
            session, id="delete_target", email="target@example.com", role="employee"
        )

        admin_id = admin.id
        target_id = target.id

        # 関連データ作成
        # 1. Card
        card = Card(
            id=str(uuid.uuid4()),
            user_id=target_id,
            card_idm="0011223344556677",
            name="Test Card",
            is_active=1,
        )
        session.add(card)

        # 2. Shift
        shift = Shift(
            id=str(uuid.uuid4()),
            user_id=target_id,
            shift_date=date(2026, 6, 12),
            start_time=datetime(2026, 6, 12, 9, 0),
            end_time=datetime(2026, 6, 12, 18, 0),
            google_event_id="dummy_event_id",
        )
        session.add(shift)

        # 3. Attendance
        attendance = Attendance(
            id=str(uuid.uuid4()),
            user_id=target_id,
            card_idm="0011223344556677",
            work_date=datetime(2026, 6, 12),
            check_in=datetime(2026, 6, 12, 9, 0),
            check_out=datetime(2026, 6, 12, 18, 0),
            source="webusb_nfc",
        )
        session.add(attendance)
        await session.commit()

        attendance_id = attendance.id

        # 4. AttendanceChangeLog
        change_log = AttendanceChangeLog(
            id=str(uuid.uuid4()),
            attendance_id=attendance_id,
            actor_user_id=admin_id,
            actor_role="admin",
            before_check_in=None,
            before_check_out=None,
            after_check_in=datetime(2026, 6, 12, 9, 0),
            after_check_out=datetime(2026, 6, 12, 18, 0),
            reason="Initial check-in",
        )
        session.add(change_log)

        # ユーザーが実行した変更ログ
        user_actor_log = AttendanceChangeLog(
            id=str(uuid.uuid4()),
            attendance_id=attendance_id,
            actor_user_id=target_id,
            actor_role="employee",
            before_check_in=datetime(2026, 6, 12, 9, 0),
            before_check_out=None,
            after_check_in=datetime(2026, 6, 12, 9, 0),
            after_check_out=datetime(2026, 6, 12, 18, 0),
            reason="Check-out complete",
        )
        session.add(user_actor_log)

        # 5. AttendanceCorrectionRequest
        correction_req = AttendanceCorrectionRequest(
            id=str(uuid.uuid4()),
            attendance_id=attendance_id,
            user_id=target_id,
            requested_check_in=datetime(2026, 6, 12, 9, 15),
            requested_check_out=datetime(2026, 6, 12, 18, 0),
            reason="Late train",
            status="approved",
            approved_by_user_id=admin_id,
        )
        session.add(correction_req)

        # ユーザーが承認した申請 (テスト用に別ユーザーの申請をtargetが承認したと仮定)
        other_user = await _create_user(
            session, id="other_user", email="other@example.com", role="employee"
        )
        other_user_id = other_user.id
        other_attendance = Attendance(
            id=str(uuid.uuid4()),
            user_id=other_user_id,
            work_date=datetime(2026, 6, 12),
            check_in=datetime(2026, 6, 12, 10, 0),
            source="web_user_id",
        )
        session.add(other_attendance)
        await session.commit()

        other_correction_req = AttendanceCorrectionRequest(
            id=str(uuid.uuid4()),
            attendance_id=other_attendance.id,
            user_id=other_user_id,
            requested_check_in=datetime(2026, 6, 12, 10, 0),
            reason="Forgot to punch",
            status="approved",
            approved_by_user_id=target_id,  # targetが承認
        )
        session.add(other_correction_req)
        other_correction_req_id = other_correction_req.id

        # 6. AttendanceLock (target が実行したロック)
        att_lock = AttendanceLock(
            year_month="2026-06",
            locked_by_user_id=target_id,
        )
        session.add(att_lock)

        # 7. UserProfileChangeLog
        profile_log = UserProfileChangeLog(
            id=str(uuid.uuid4()),
            user_id=target_id,
            actor_user_id=admin_id,
            actor_role="admin",
            event_type="profile",
            before_name="Old Name",
            after_name="New Name",
            reason="Admin changed name",
        )
        session.add(profile_log)

        # 8. EmailVerificationRequest
        email_req = EmailVerificationRequest(
            id=str(uuid.uuid4()),
            user_id=target_id,
            requested_email="new_target@example.com",
            verification_type="email_change",
            token_hash="dummy_hash",
            requested_by_user_id=target_id,
            sent_via="gmail_api",
            expires_at=datetime.now(tz=UTC).replace(tzinfo=None),
        )
        session.add(email_req)

        await session.commit()

        # ログイン
        token = await _login(account_id=admin_id)
        headers = {"Authorization": f"Bearer {token}"}

        # 物理削除を実行
        response = await client.delete(
            f"/api/v1/users/{target_id}?hard=true", headers=headers
        )
        assert response.status_code == 204

        # セッションキャッシュをクリア
        session.expire_all()

        # 各テーブルからデータが消えていることを検証
        assert (await session.execute(select(User).where(User.id == target_id))).scalar_one_or_none() is None
        assert (await session.execute(select(Card).where(Card.user_id == target_id))).scalar_one_or_none() is None
        assert (await session.execute(select(Shift).where(Shift.user_id == target_id))).scalar_one_or_none() is None
        assert (
            (await session.execute(select(Attendance).where(Attendance.user_id == target_id)))
        ).scalar_one_or_none() is None
        assert (
            (await session.execute(select(AttendanceChangeLog).where(AttendanceChangeLog.actor_user_id == target_id)))
        ).scalars().all() == []
        assert (
            (await session.execute(select(AttendanceChangeLog).where(AttendanceChangeLog.attendance_id == attendance_id)))
        ).scalars().all() == []
        assert (
            (await session.execute(select(AttendanceCorrectionRequest).where(AttendanceCorrectionRequest.user_id == target_id)))
        ).scalars().all() == []
        assert (
            (await session.execute(select(AttendanceLock).where(AttendanceLock.locked_by_user_id == target_id)))
        ).scalar_one_or_none() is None
        assert (
            (await session.execute(select(UserProfileChangeLog).where(
                (UserProfileChangeLog.user_id == target_id) | (UserProfileChangeLog.actor_user_id == target_id)
            )))
        ).scalars().all() == []
        assert (
            (await session.execute(select(EmailVerificationRequest).where(EmailVerificationRequest.user_id == target_id)))
        ).scalars().all() == []

        # targetが承認した他人の申請の承認者が NULL にクリアされていること
        other_req_db = (
            await session.execute(
                select(AttendanceCorrectionRequest).where(
                    AttendanceCorrectionRequest.id == other_correction_req_id
                )
            )
        ).scalar_one()
        assert other_req_db.approved_by_user_id is None

    @pytest.mark.asyncio
    async def test_soft_delete_default(self, client: AsyncClient, session) -> None:
        """デフォルト(hard=false)では論理削除(is_active=0)になり、データが保持されること。"""
        admin = await _create_user(
            session, id="adminuser2", email="admin2@example.com", role="admin"
        )
        target = await _create_user(
            session, id="target2", email="target2@example.com", role="employee"
        )

        admin_id = admin.id
        target_id = target.id

        token = await _login(account_id=admin_id)
        headers = {"Authorization": f"Bearer {token}"}

        # 論理削除を実行
        response = await client.delete(f"/api/v1/users/{target_id}", headers=headers)
        assert response.status_code == 204

        session.expire_all()

        # ユーザーはDBに存在するが is_active = 0 になっていること
        db_user = (await session.execute(select(User).where(User.id == target_id))).scalar_one()
        assert db_user.is_active == 0

    @pytest.mark.asyncio
    async def test_permission_denied(self, client: AsyncClient, session) -> None:
        """一般従業員は物理削除を実行できないこと(403)。"""
        emp = await _create_user(
            session, id="empuser", email="emp@example.com", role="employee"
        )
        target = await _create_user(
            session, id="target3", email="target3@example.com", role="employee"
        )

        emp_id = emp.id
        target_id = target.id

        token = await _login(account_id=emp_id)
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.delete(
            f"/api/v1/users/{target_id}?hard=true", headers=headers
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_last_admin_protection(self, client: AsyncClient, session) -> None:
        """最後の有効な管理者は物理削除できないこと(409)。"""
        admin = await _create_user(
            session, id="lastadmin", email="lastadmin@example.com", role="admin"
        )

        admin_id = admin.id

        token = await _login(account_id=admin_id)
        headers = {"Authorization": f"Bearer {token}"}

        response = await client.delete(
            f"/api/v1/users/{admin_id}?hard=true", headers=headers
        )
        assert response.status_code == 409
        assert "最後の有効な管理者" in response.json()["message"]
