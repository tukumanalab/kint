import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select

from kint.models.attendance import Attendance, AttendanceCorrectionRequest
from kint.models.notification import Notification
from kint.models.user import User


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


async def _login(account_id: str = "testuser") -> str:
    """JWTトークンを直接生成して返す。"""
    from kint.routers.auth import _create_access_token

    return _create_access_token(account_id, 1)


class TestNotificationAPI:
    async def test_empty_notifications(self, client: AsyncClient, session: object) -> None:
        """通知が空のとき、空のリストと unread_count 0 が返る。"""
        await _create_user(session)
        token = await _login()

        resp = await client.get(
            "/api/v1/me/notifications", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["unread_count"] == 0

    async def test_list_and_read_notifications(self, client: AsyncClient, session: object) -> None:
        """通知を作成して一覧を取得し、既読化できること。"""
        user = await _create_user(session)
        token = await _login()

        from kint.services.notification import NotificationService

        notif_svc = NotificationService(session)
        notif1 = await notif_svc.create_notification(
            user_id=user.id,
            message="通知テスト1",
            category="general",
        )
        await notif_svc.create_notification(
            user_id=user.id,
            message="通知テスト2",
            category="general",
        )
        await session.commit()

        # 取得
        resp = await client.get(
            "/api/v1/me/notifications", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 2
        assert data["unread_count"] == 2
        assert data["items"][0]["message"] == "通知テスト2"  # 降順

        # 個別既読
        target_id = notif1.id
        resp_read = await client.patch(
            f"/api/v1/me/notifications/{target_id}/read",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp_read.status_code == 200
        assert resp_read.json()["is_read"] is True

        # 再取得で unread_count が1になっているか確認
        resp2 = await client.get(
            "/api/v1/me/notifications", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp2.json()["unread_count"] == 1

        # 一括既読
        resp_all = await client.patch(
            "/api/v1/me/notifications/read-all",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp_all.status_code == 204

        # 再取得で unread_count が0になっているか確認
        resp3 = await client.get(
            "/api/v1/me/notifications", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp3.json()["unread_count"] == 0


class TestAttendanceCorrectionNotification:
    async def test_reject_creates_notification(self, client: AsyncClient, session: object) -> None:
        """申請が却下された際、自動でお知らせが作成されること。"""
        # 一般ユーザーと管理者を作成
        user = await _create_user(session)
        await _create_user(session, id="adminuser", role="admin", email="admin@example.com")
        admin_token = await _login("adminuser")

        # 勤怠レコードと申請を作成
        now = datetime.now(tz=UTC).replace(tzinfo=None)
        attendance = Attendance(
            id=str(uuid.uuid4()),
            user_id=user.id,
            work_date=now.date(),
            check_in=now - timedelta(hours=8),
            check_out=None,
            source="webusb_nfc",
        )
        session.add(attendance)
        await session.commit()

        req = AttendanceCorrectionRequest(
            id=str(uuid.uuid4()),
            attendance_id=attendance.id,
            user_id=user.id,
            requested_check_in=now - timedelta(hours=8),
            requested_check_out=now,
            reason="打刻忘れ",
            status="pending",
        )
        session.add(req)
        await session.commit()

        # 却下APIを叩く
        resp = await client.post(
            f"/api/v1/attendance/requests/{req.id}/reject",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"approval_comment": "証拠がありません"},
        )

        assert resp.status_code == 200

        # 通知がDBにあるか確認
        from kint.services.notification import NotificationService

        notif_svc = NotificationService(session)
        items, count = await notif_svc.list_notifications(user.id)
        assert count == 1
        assert "却下されました" in items[0].message
        assert "証拠がありません" in items[0].message
        assert items[0].category == "correction_rejected"
        assert items[0].reference_id == req.id


class TestPunchNotification:
    async def test_punch_returns_has_unread_notifications(
        self, client: AsyncClient, session: object
    ) -> None:
        """未読通知がある場合、打刻レスポンスに has_unread_notifications: true が含まれること。"""
        user = await _create_user(session)
        user_token = await _login()

        # 打刻機トークン認証は一旦通すためにダミーの device_id を指定
        # 未読なし状態での打刻
        now = datetime.now(tz=UTC)
        resp1 = await client.post(
            "/api/v1/punches",
            json={
                "device_id": "test_device",
                "occurred_at": now.isoformat(),
                "user_id": user.id,
                "reason": "手動打刻",
            },
        )
        assert resp1.status_code == 200
        assert resp1.json()["has_unread_notifications"] is False

        # 通知を作成する
        from kint.services.notification import NotificationService

        notif_svc = NotificationService(session)
        await notif_svc.create_notification(
            user_id=user.id,
            message="未読通知テスト",
        )
        await session.commit()

        # 未読あり状態での打刻 (退勤打刻になる)
        resp2 = await client.post(
            "/api/v1/punches",
            json={
                "device_id": "test_device",
                "occurred_at": (now + timedelta(seconds=10)).isoformat(),
                "user_id": user.id,
                "reason": "手動打刻",
            },
        )
        assert resp2.status_code == 200
        assert resp2.json()["has_unread_notifications"] is True

        # 通知を既読にする
        await client.patch(
            "/api/v1/me/notifications/read-all",
            headers={"Authorization": f"Bearer {user_token}"},
        )

        # 既読後の打刻 (5分以内の退勤になるため削除されるか、時間をずらして出勤打刻にする)
        resp3 = await client.post(
            "/api/v1/punches",
            json={
                "device_id": "test_device",
                "occurred_at": (now + timedelta(minutes=10)).isoformat(),
                "user_id": user.id,
                "reason": "手動打刻",
            },
        )
        assert resp3.status_code == 200
        assert resp3.json()["has_unread_notifications"] is False


class TestNotificationCleanup:
    async def test_cleanup_deletes_old_notifications(self, session: object) -> None:
        """180日以上経過した通知のみ削除されること。"""
        user = await _create_user(session)

        from kint.services.notification import NotificationService

        notif_svc = NotificationService(session)

        # 古い通知（181日前）
        n_old = Notification(
            id="old_notif",
            user_id=user.id,
            message="古い通知",
            is_read=False,
            created_at=datetime.now(tz=UTC) - timedelta(days=181),
        )
        # 新しい通知（179日前）
        n_new = Notification(
            id="new_notif",
            user_id=user.id,
            message="新しい通知",
            is_read=False,
            created_at=datetime.now(tz=UTC) - timedelta(days=179),
        )

        session.add(n_old)
        session.add(n_new)
        await session.commit()

        # クリーンアップ実行
        deleted = await notif_svc.cleanup_old_notifications(days=180)
        assert deleted == 1

        # DBチェック
        res_old = await session.execute(select(Notification).where(Notification.id == "old_notif"))
        assert res_old.scalar_one_or_none() is None

        res_new = await session.execute(select(Notification).where(Notification.id == "new_notif"))
        assert res_new.scalar_one_or_none() is not None


class TestNotificationCascadeDelete:
    async def test_delete_user_cascades_notifications(self, session: object) -> None:
        """ユーザーを削除すると、紐付いている通知もカスケード削除されること。"""
        user = await _create_user(session)

        from kint.services.notification import NotificationService

        notif_svc = NotificationService(session)
        notif = await notif_svc.create_notification(
            user_id=user.id,
            message="カスケード削除テスト",
        )
        await session.commit()

        # ユーザー削除
        await session.delete(user)
        await session.commit()

        # 通知が削除されていることを確認
        res_notif = await session.execute(select(Notification).where(Notification.id == notif.id))
        assert res_notif.scalar_one_or_none() is None
