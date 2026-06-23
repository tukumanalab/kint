"""シフトカレンダー同期 API のテスト。"""

from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.shift import Shift
from kint.models.user import User

# ---------------------------------------------------------------------------
# ヘルパー
# ---------------------------------------------------------------------------

_ICAL_TEMPLATE = """\
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:{uid}
DTSTART:{dtstart}
DTEND:{dtend}
ATTENDEE;ROLE=REQ-PARTICIPANT:MAILTO:{email}
END:VEVENT
END:VCALENDAR
"""


def _make_ical(
    uid: str = "event-001",
    dtstart: str = "20260601T090000Z",
    dtend: str = "20260601T170000Z",
    email: str = "employee@example.com",
) -> bytes:
    """テスト用 iCal バイト列を生成する。"""
    return _ICAL_TEMPLATE.format(uid=uid, dtstart=dtstart, dtend=dtend, email=email).encode()


async def _create_admin(session: AsyncSession, user_id: str = "admin-001") -> User:
    """テスト用管理者ユーザーを作成する。"""
    user = User(
        id=user_id,
        name="admin",
        full_name="管理 太郎",
        email="admin@example.com",
        role="admin",
        is_active=1,
        token_version=1,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_employee(
    session: AsyncSession,
    user_id: str = "emp-001",
    email: str = "employee@example.com",
) -> User:
    """テスト用従業員ユーザーを作成する。"""
    user = User(
        id=user_id,
        name="employee",
        full_name="従業 花子",
        email=email,
        role="employee",
        is_active=1,
        token_version=1,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _get_admin_token(client: AsyncClient) -> str:
    """ログインして管理者 JWT トークンを取得する。"""
    from kint.routers.auth import _create_access_token

    return _create_access_token("admin-001", 1)


async def _get_employee_token(client: AsyncClient) -> str:
    """ログインして従業員 JWT トークンを取得する。"""
    from kint.routers.auth import _create_access_token

    return _create_access_token("emp-001", 1)


# ---------------------------------------------------------------------------
# テストクラス
# ---------------------------------------------------------------------------


class TestShiftSync:
    """POST /api/v1/shifts/sync のテスト。"""

    async def test_sync_accepted_by_admin(self, client: AsyncClient, session: AsyncSession) -> None:
        """管理者が同期リクエストを送ると 202 が返る。"""
        await _create_admin(session)
        await _create_employee(session)
        token = await _get_admin_token(client)

        with (
            patch("kint.routers.shifts._run_sync_in_background", new_callable=AsyncMock),
            patch("kint.config.settings.shift_ical_url", "https://example.com/cal.ics"),
        ):
            resp = await client.post(
                "/api/v1/shifts/sync",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert resp.status_code == 202
        assert resp.json()["accepted"] is True

    async def test_sync_forbidden_for_employee(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """従業員が同期リクエストを送ると 403 が返る。"""
        await _create_admin(session)
        await _create_employee(session)
        token = await _get_employee_token(client)

        resp = await client.post(
            "/api/v1/shifts/sync",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    async def test_sync_unauthenticated(self, client: AsyncClient) -> None:
        """未認証では 401 が返る。"""
        resp = await client.post("/api/v1/shifts/sync")
        assert resp.status_code == 401


class TestShiftSyncNow:
    """POST /api/v1/shifts/sync/now のテスト。"""

    async def test_sync_now_success_by_admin(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """管理者が即時同期をリクエストすると、成功ステータスと統計が返る。"""
        await _create_admin(session)
        employee = await _create_employee(session)
        token = await _get_admin_token(client)
        ical = _make_ical(email=employee.email)

        with (
            patch(
                "kint.services.calendar_sync.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_fetch,
            patch(
                "kint.services.settings.SettingsService.get_str", new_callable=AsyncMock
            ) as mock_get_str,
        ):
            mock_fetch.return_value = ical
            mock_get_str.return_value = "https://example.com/cal.ics"

            resp = await client.post(
                "/api/v1/shifts/sync/now",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["stats"]["inserted"] == 1

    async def test_sync_now_forbidden_for_employee(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """従業員が即時同期をリクエストすると 403 が返る。"""
        await _create_admin(session)
        await _create_employee(session)
        token = await _get_employee_token(client)

        resp = await client.post(
            "/api/v1/shifts/sync/now",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    async def test_sync_now_unauthenticated(self, client: AsyncClient) -> None:
        """未認証では 401 が返る。"""
        resp = await client.post("/api/v1/shifts/sync/now")
        assert resp.status_code == 401

    async def test_sync_now_fails_when_ical_url_not_set(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """iCal URLが未設定の時は 400 エラーが返る。"""
        await _create_admin(session)
        token = await _get_admin_token(client)

        with patch(
            "kint.services.settings.SettingsService.get_str", new_callable=AsyncMock
        ) as mock_get_str:
            mock_get_str.return_value = None

            resp = await client.post(
                "/api/v1/shifts/sync/now",
                headers={"Authorization": f"Bearer {token}"},
            )

        assert resp.status_code == 400
        assert resp.json()["code"] == "CALENDAR_SYNC_FAILED"


class TestCalendarSyncService:
    """CalendarSyncService の単体テスト。"""

    async def test_sync_inserts_new_shift(self, session: AsyncSession) -> None:
        """iCal に存在するシフトが DB に新規挿入される。"""
        from kint.services.calendar_sync import CalendarSyncService

        employee = await _create_employee(session)
        ical = _make_ical(email=employee.email)

        with (
            patch(
                "kint.services.calendar_sync.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_fetch,
            patch(
                "kint.services.settings.SettingsService.get_str", new_callable=AsyncMock
            ) as mock_get_str,
        ):
            mock_fetch.return_value = ical
            mock_get_str.return_value = "https://example.com/cal.ics"

            service = CalendarSyncService(session)
            stats = await service.sync()

        assert stats["inserted"] == 1
        assert stats["updated"] == 0

        result = await session.execute(
            __import__("sqlalchemy", fromlist=["select"])
            .select(Shift)
            .where(Shift.google_event_id == "event-001")
        )
        shift = result.scalar_one_or_none()
        assert shift is not None
        assert shift.user_id == employee.id

    async def test_sync_updates_existing_shift(self, session: AsyncSession) -> None:
        """既存シフトの時刻が変更された場合に UPDATE される。"""
        from sqlalchemy import select

        from kint.services.calendar_sync import CalendarSyncService

        employee = await _create_employee(session)

        # 既存シフトを作成
        existing = Shift(
            id="shift-existing",
            user_id=employee.id,
            shift_date=date(2026, 6, 1),
            start_time=datetime(2026, 6, 1, 9, 0, tzinfo=UTC),
            end_time=datetime(2026, 6, 1, 15, 0, tzinfo=UTC),  # 古い終了時刻
            google_event_id="event-001",
        )
        session.add(existing)
        await session.commit()

        # 終了時刻が 17:00Z に変更された iCal
        ical = _make_ical(email=employee.email, dtend="20260601T170000Z")

        with (
            patch(
                "kint.services.calendar_sync.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_fetch,
            patch(
                "kint.services.settings.SettingsService.get_str", new_callable=AsyncMock
            ) as mock_get_str,
        ):
            mock_fetch.return_value = ical
            mock_get_str.return_value = "https://example.com/cal.ics"

            service = CalendarSyncService(session)
            stats = await service.sync()

        assert stats["updated"] == 1
        assert stats["inserted"] == 0

        result = await session.execute(select(Shift).where(Shift.google_event_id == "event-001"))
        shift = result.scalar_one_or_none()
        assert shift is not None
        assert shift.end_time == datetime(2026, 6, 1, 17, 0, tzinfo=UTC)

    async def test_sync_deletes_removed_future_shift(self, session: AsyncSession) -> None:
        """iCal から削除された未来のシフトが DB からも削除される。"""
        from sqlalchemy import select

        from kint.services.calendar_sync import CalendarSyncService

        employee = await _create_employee(session)

        # 削除予定の未来シフトを DB に登録
        removed_shift = Shift(
            id="shift-removed",
            user_id=employee.id,
            shift_date=date(2099, 1, 1),  # 確実に未来
            start_time=datetime(2099, 1, 1, 9, 0, tzinfo=UTC),
            end_time=datetime(2099, 1, 1, 17, 0, tzinfo=UTC),
            google_event_id="event-removed",
        )
        session.add(removed_shift)
        await session.commit()

        # iCal には event-001 のみ（event-removed は存在しない）
        ical = _make_ical(email=employee.email)

        with (
            patch(
                "kint.services.calendar_sync.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_fetch,
            patch(
                "kint.services.settings.SettingsService.get_str", new_callable=AsyncMock
            ) as mock_get_str,
        ):
            mock_fetch.return_value = ical
            mock_get_str.return_value = "https://example.com/cal.ics"

            service = CalendarSyncService(session)
            stats = await service.sync()

        assert stats["deleted"] == 1

        result = await session.execute(
            select(Shift).where(Shift.google_event_id == "event-removed")
        )
        assert result.scalar_one_or_none() is None

    async def test_sync_skips_unknown_attendee(self, session: AsyncSession) -> None:
        """存在しないメールアドレスの ATTENDEE はスキップされる。"""
        from kint.services.calendar_sync import CalendarSyncService

        await _create_employee(session)

        # 存在しないメールで作成した iCal
        ical = _make_ical(email="nobody@unknown.example.com")

        with (
            patch(
                "kint.services.calendar_sync.asyncio.to_thread", new_callable=AsyncMock
            ) as mock_fetch,
            patch(
                "kint.services.settings.SettingsService.get_str", new_callable=AsyncMock
            ) as mock_get_str,
        ):
            mock_fetch.return_value = ical
            mock_get_str.return_value = "https://example.com/cal.ics"

            service = CalendarSyncService(session)
            stats = await service.sync()

        assert stats["inserted"] == 0
        assert stats["skipped"] == 1

    async def test_sync_raises_when_ical_url_not_set(self, session: AsyncSession) -> None:
        """SHIFT_ICAL_URL 未設定時は CalendarSyncError が送出される。"""
        from kint.services.calendar_sync import CalendarSyncError, CalendarSyncService

        with patch(
            "kint.services.settings.SettingsService.get_str", new_callable=AsyncMock
        ) as mock_get_str:
            mock_get_str.return_value = None

            service = CalendarSyncService(session)
            with pytest.raises(CalendarSyncError, match="SHIFT_ICAL_URL"):
                await service.sync()
