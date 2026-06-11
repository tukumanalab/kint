from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.attendance import Attendance
from kint.models.card import Card
from kint.models.shift import Shift
from kint.models.user import User


async def _create_user(session: AsyncSession, user_id: str = "user-001") -> User:
    """テスト用ユーザーを作成する。"""
    user = User(
        id=user_id,
        name="taro",
        full_name="山田 太郎",
        email=f"{user_id}@example.com",
        role="employee",
        is_active=1,
        token_version=1,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_card(
    session: AsyncSession,
    user_id: str,
    card_idm: str = "0123456789ABCDEF",
) -> Card:
    """テスト用 NFC カードを作成する。"""
    card = Card(
        id=f"card-{user_id}",
        user_id=user_id,
        card_idm=card_idm,
        name="社員証",
        is_active=1,
    )
    session.add(card)
    await session.commit()
    await session.refresh(card)
    return card


async def _create_shift(
    session: AsyncSession,
    *,
    user_id: str,
    start_time: datetime,
    end_time: datetime,
    event_id: str = "event-001",
) -> Shift:
    """テスト用シフトを作成する。"""
    shift = Shift(
        id=f"shift-{event_id}",
        user_id=user_id,
        shift_date=start_time.date(),
        start_time=start_time,
        end_time=end_time,
        google_event_id=event_id,
    )
    session.add(shift)
    await session.commit()
    await session.refresh(shift)
    return shift


class TestPunchRules:
    async def test_allows_multiple_check_in_out_cycles_in_same_day(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """同一日に退勤済みなら再出勤できる。"""
        user = await _create_user(session)
        await _create_card(session, user.id)
        start = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        await _create_shift(
            session,
            user_id=user.id,
            start_time=start,
            end_time=datetime(2026, 5, 16, 18, 0, tzinfo=UTC),
        )

        check_in_resp = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "0123456789ABCDEF",
                "device_id": "web-browser",
                "occurred_at": start.isoformat(),
            },
        )
        check_out_resp = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "0123456789ABCDEF",
                "device_id": "web-browser",
                "occurred_at": (start + timedelta(hours=3)).isoformat(),
            },
        )
        second_check_in_resp = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "0123456789ABCDEF",
                "device_id": "web-browser",
                "occurred_at": (start + timedelta(hours=4)).isoformat(),
            },
        )

        assert check_in_resp.status_code == 200
        assert check_in_resp.json()["action"] == "check_in"
        assert check_out_resp.status_code == 200
        assert check_out_resp.json()["action"] == "check_out"
        assert second_check_in_resp.status_code == 200
        assert second_check_in_resp.json()["action"] == "check_in"

        result = await session.execute(select(Attendance).where(Attendance.user_id == user.id))
        rows = result.scalars().all()
        assert len(rows) == 2

    async def test_rejects_rapid_consecutive_punch_with_cooldown(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """クールダウン秒以内の連続打刻を拒否する。"""
        user = await _create_user(session)
        await _create_card(session, user.id)
        base_time = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        await _create_shift(
            session,
            user_id=user.id,
            start_time=base_time,
            end_time=datetime(2026, 5, 16, 18, 0, tzinfo=UTC),
        )

        first = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "0123456789ABCDEF",
                "device_id": "web-browser",
                "occurred_at": base_time.isoformat(),
            },
        )
        second = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "0123456789ABCDEF",
                "device_id": "web-browser",
                "occurred_at": (base_time + timedelta(seconds=30)).isoformat(),
            },
        )

        assert first.status_code == 200
        assert second.status_code == 409
        assert second.json()["code"] == "PUNCH_COOLDOWN_ACTIVE"

    async def test_requires_confirmation_when_check_in_without_shift(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """シフト外の出勤は確認レスポンスを返し confirm=true で確定できる。"""
        user = await _create_user(session)
        await _create_card(session, user.id)
        occurred_at = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)

        first = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "0123456789ABCDEF",
                "device_id": "web-browser",
                "occurred_at": occurred_at.isoformat(),
            },
        )

        assert first.status_code == 200
        first_body = first.json()
        assert first_body["status"] == "requires_confirmation"
        assert first_body["action"] is None

        pre_result = await session.execute(select(Attendance).where(Attendance.user_id == user.id))
        assert len(pre_result.scalars().all()) == 0

        second = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "0123456789ABCDEF",
                "confirm": True,
                "device_id": "web-browser",
                "occurred_at": occurred_at.isoformat(),
            },
        )

        assert second.status_code == 200
        assert second.json()["status"] == "completed"
        assert second.json()["action"] == "check_in"

    async def test_prioritizes_check_out_when_open_attendance_exists(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """未退勤レコードがあればシフト有無に関係なく退勤判定する。"""
        user = await _create_user(session)
        await _create_card(session, user.id)

        open_attendance = Attendance(
            id="att-open-001",
            user_id=user.id,
            card_idm="0123456789ABCDEF",
            work_date=date(2026, 5, 16),
            check_in=datetime(2026, 5, 16, 8, 0, tzinfo=UTC),
            check_out=None,
            source="webusb_nfc",
            updated_reason=None,
            last_updated_by_user_id=None,
            last_updated_at=None,
        )
        session.add(open_attendance)
        await session.commit()

        response = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "0123456789ABCDEF",
                "device_id": "web-browser",
                "occurred_at": datetime(2026, 5, 16, 10, 0, tzinfo=UTC).isoformat(),
            },
        )

        assert response.status_code == 200
        assert response.json()["status"] == "completed"
        assert response.json()["action"] == "check_out"

    async def test_punch_calculated_fields_in_response(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """打刻時の丸め処理後の勤務出退勤時刻と労働時間の計算がレスポンスに含まれること。"""
        user = await _create_user(session, user_id="user-002")
        await _create_card(session, user.id, card_idm="2222222222222222")
        
        # 9:00〜18:00 のシフトを作成
        shift_start = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        shift_end = datetime(2026, 5, 16, 18, 0, tzinfo=UTC)
        await _create_shift(session, user_id=user.id, start_time=shift_start, end_time=shift_end, event_id="event-002")

        # 1. 出勤打刻（シフト開始後: 9:03）
        # 5分切り上げで 9:05 に丸められるはず
        punch_in_time = datetime(2026, 5, 16, 9, 3, tzinfo=UTC)
        response_in = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "2222222222222222",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )
        assert response_in.status_code == 200
        res_in_data = response_in.json()
        assert res_in_data["action"] == "check_in"
        # ISO8601表記で確認 (タイムゾーンはZまたは+00:00になる可能性があるためstartswithで一致を見る)
        assert res_in_data["calculated_time"].startswith("2026-05-16T09:05:00")
        assert res_in_data["current_working_hours"] is None
        assert res_in_data["daily_working_hours_total"] is None

        # 2. 退勤打刻（シフト終了前: 17:58）
        # 5分切り捨てで 17:55 に丸められるはず
        # 9:05〜17:55 は 8時間50分 = 8.83時間
        # 1日の合計も 8.83時間になるはず
        punch_out_time = datetime(2026, 5, 16, 17, 58, tzinfo=UTC)
        response_out = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "2222222222222222",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
            },
        )
        assert response_out.status_code == 200
        res_out_data = response_out.json()
        assert res_out_data["action"] == "check_out"
        assert res_out_data["calculated_time"].startswith("2026-05-16T17:55:00")
        assert res_out_data["current_working_hours"] == 8.83
        assert res_out_data["daily_working_hours_total"] == 8.83

    async def test_punch_calculated_fields_with_shift_edge(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """シフト開始前および終了後の打刻で、それぞれシフト境界に補正されること。"""
        user = await _create_user(session, user_id="user-003")
        await _create_card(session, user.id, card_idm="3333333333333333")
        
        # 9:00〜18:00 のシフトを作成
        shift_start = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        shift_end = datetime(2026, 5, 16, 18, 0, tzinfo=UTC)
        await _create_shift(session, user_id=user.id, start_time=shift_start, end_time=shift_end, event_id="event-003")

        # シフト開始前（8:50）に打刻
        # 9:00 に丸められるはず
        punch_in_time = datetime(2026, 5, 16, 8, 50, tzinfo=UTC)
        response_in = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "3333333333333333",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )
        assert response_in.status_code == 200
        res_in_data = response_in.json()
        assert res_in_data["calculated_time"].startswith("2026-05-16T09:00:00")

        # シフト終了後（18:10）に打刻
        # 18:00 に丸められるはず
        # 9:00〜18:00 は 9.00時間
        punch_out_time = datetime(2026, 5, 16, 18, 10, tzinfo=UTC)
        response_out = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "3333333333333333",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
            },
        )
        assert response_out.status_code == 200
        res_out_data = response_out.json()
        assert res_out_data["calculated_time"].startswith("2026-05-16T18:00:00")
        assert res_out_data["current_working_hours"] == 9.0
        assert res_out_data["daily_working_hours_total"] == 9.0

    async def test_punch_calculated_fields_without_shift(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """シフトがない場合の打刻で、出勤は5分切り上げ、退勤は5分切り捨てになること。"""
        user = await _create_user(session, user_id="user-004")
        await _create_card(session, user.id, card_idm="4444444444444444")

        # 1. 出勤打刻（シフトなし: 9:02）
        # 5分切り上げで 9:05 に丸められるはず
        punch_in_time = datetime(2026, 5, 16, 9, 2, tzinfo=UTC)
        response_in = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "4444444444444444",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
                "confirm": True,  # シフトがないため confirm=True が必要
            },
        )
        assert response_in.status_code == 200
        res_in_data = response_in.json()
        assert res_in_data["action"] == "check_in"
        assert res_in_data["calculated_time"].startswith("2026-05-16T09:05:00")

        # 2. 退勤打刻（シフトなし: 18:04）
        # 5分切り捨てで 18:00 に丸められるはず
        # 9:05〜18:00 は 8時間55分 = 8.92時間
        punch_out_time = datetime(2026, 5, 16, 18, 4, tzinfo=UTC)
        response_out = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "4444444444444444",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
            },
        )
        assert response_out.status_code == 200
        res_out_data = response_out.json()
        assert res_out_data["action"] == "check_out"
        assert res_out_data["calculated_time"].startswith("2026-05-16T18:00:00")
        assert res_out_data["current_working_hours"] == 8.92
        assert res_out_data["daily_working_hours_total"] == 8.92

