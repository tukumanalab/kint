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
        from kint.models.system_setting import SystemSetting

        session.add(
            SystemSetting(
                key="punch_cooldown_seconds",
                value="60",
                updated_by_user_id=user.id,
            )
        )
        await session.commit()

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

    async def test_ignores_rapid_consecutive_punch_within_10_seconds(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """10秒以内の連続打刻を無視（200 OK、ただしDB等への追加は無し、actionはNone）する。"""
        user = await _create_user(session)
        from kint.models.system_setting import SystemSetting

        session.add(
            SystemSetting(
                key="punch_cooldown_seconds",
                value="60",
                updated_by_user_id=user.id,
            )
        )
        await session.commit()

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
                "occurred_at": (base_time + timedelta(seconds=5)).isoformat(),
            },
        )

        assert first.status_code == 200
        assert first.json()["action"] == "check_in"

        assert second.status_code == 200
        second_json = second.json()
        assert second_json["status"] == "completed"
        assert second_json["action"] is None
        assert "無視されました" in second_json["message"]

        # DB 上の勤怠レコードが1件（最初の打刻のみ）であることを確認
        user_id = user.id
        session.expire_all()
        result = await session.execute(select(Attendance).where(Attendance.user_id == user_id))
        rows = result.scalars().all()
        assert len(rows) == 1

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
        await _create_shift(
            session,
            user_id=user.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-002",
        )

        # 1. 出勤打刻（シフト開始後: 9:03）
        # 5分切り捨てで 9:00 に丸められるはず
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
        assert res_in_data["calculated_time"].startswith("2026-05-16T09:00:00")
        assert res_in_data["current_working_hours"] is None
        assert res_in_data["daily_working_hours_total"] is None

        # 2. 退勤打刻（シフト終了前: 17:58）
        # 5分切り上げで 18:00 に丸められるはず
        # 9:00〜18:00 は 9.0時間
        # 1日の合計も 9.0時間になるはず
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
        assert res_out_data["calculated_time"].startswith("2026-05-16T18:00:00")
        assert res_out_data["current_working_hours"] == 9.0
        assert res_out_data["daily_working_hours_total"] == 9.0

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
        await _create_shift(
            session,
            user_id=user.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-003",
        )

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
        # 5分切り捨てで 9:00 に丸められるはず
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
        assert res_in_data["calculated_time"].startswith("2026-05-16T09:00:00")

        # 2. 退勤打刻（シフトなし: 18:04）
        # 5分切り上げで 18:05 に丸められるはず
        # 9:00〜18:05 は 9時間5分 = 9.08時間
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
        assert res_out_data["calculated_time"].startswith("2026-05-16T18:05:00")
        assert res_out_data["current_working_hours"] == 9.08
        assert res_out_data["daily_working_hours_total"] == 9.08

    async def test_punch_calculated_fields_with_microseconds(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """打刻時刻にマイクロ秒が含まれていても、丸め後の退勤時刻が正しく計算されること。"""
        user = await _create_user(session, user_id="user-005")
        await _create_card(session, user.id, card_idm="5555555555555555")

        # シフトを作成（9:00〜18:00）
        shift_start = datetime(2026, 6, 4, 9, 0, tzinfo=UTC)
        shift_end = datetime(2026, 6, 4, 18, 0, tzinfo=UTC)
        await _create_shift(
            session,
            user_id=user.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-005",
        )

        # 1. 出勤打刻 (9:00:00.123456) -> 9:00:00 に丸められるはず
        punch_in_time = datetime(2026, 6, 4, 9, 0, 0, 123456, tzinfo=UTC)
        response_in = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "5555555555555555",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )
        assert response_in.status_code == 200
        res_in_data = response_in.json()
        assert res_in_data["calculated_time"].startswith("2026-06-04T09:00:00")

        # 2. 退勤打刻 (17:47:32.440000) -> 17:50:00 に丸められるはず
        punch_out_time = datetime(2026, 6, 4, 17, 47, 32, 440000, tzinfo=UTC)
        response_out = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "5555555555555555",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
            },
        )
        assert response_out.status_code == 200
        res_out_data = response_out.json()
        assert res_out_data["calculated_time"].startswith("2026-06-04T17:50:00")

    async def test_punch_calculated_fields_truncates_seconds(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """打刻時刻の秒は切り捨てて分単位で丸めること（13:00:59 -> 13:00:00）。"""
        user = await _create_user(session, user_id="user-006")
        await _create_card(session, user.id, card_idm="6666666666666666")

        # シフトを作成（13:00〜18:00）
        shift_start = datetime(2026, 6, 4, 13, 0, tzinfo=UTC)
        shift_end = datetime(2026, 6, 4, 18, 0, tzinfo=UTC)
        await _create_shift(
            session,
            user_id=user.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-006",
        )

        # 出勤打刻 (13:00:59) -> 秒を切り捨てて 13:00 として扱い、13:00:00 に丸められるはず
        punch_in_time = datetime(2026, 6, 4, 13, 0, 59, tzinfo=UTC)
        response_in = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "6666666666666666",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )
        assert response_in.status_code == 200
        res_in_data = response_in.json()
        assert res_in_data["action"] == "check_in"
        assert res_in_data["calculated_time"].startswith("2026-06-04T13:00:00")

    async def test_punch_calculated_fields_truncates_seconds_without_shift(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """シフトがない場合も打刻の秒を切り捨てて丸めること（13:00:59 -> 13:00:00）。"""
        user = await _create_user(session, user_id="user-007")
        await _create_card(session, user.id, card_idm="7777777777777777")

        # 出勤打刻（シフトなし: 13:00:59）-> 秒を切り捨てて 13:00:00 に丸められるはず
        punch_in_time = datetime(2026, 6, 4, 13, 0, 59, tzinfo=UTC)
        response_in = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "7777777777777777",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
                "confirm": True,  # シフトがないため confirm=True が必要
            },
        )
        assert response_in.status_code == 200
        res_in_data = response_in.json()
        assert res_in_data["action"] == "check_in"
        assert res_in_data["calculated_time"].startswith("2026-06-04T13:00:00")

    async def test_punch_cancel_within_5_minutes(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """出勤打刻から5分以内の退勤打刻で、出退勤記録が削除（取り消し）されること。"""
        user_id = "user-cancel-1"
        user = await _create_user(session, user_id=user_id)
        await _create_card(session, user.id, card_idm="9999999999999999")

        # 9:00〜18:00 のシフトを作成
        shift_start = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        shift_end = datetime(2026, 5, 16, 18, 0, tzinfo=UTC)
        await _create_shift(
            session,
            user_id=user.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-cancel-1",
        )

        # 1. 出勤打刻 (9:01:00)
        punch_in_time = datetime(2026, 5, 16, 9, 1, 0, tzinfo=UTC)
        response_in = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "9999999999999999",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )
        assert response_in.status_code == 200
        assert response_in.json()["action"] == "check_in"

        # レコードが1つ作られていることを確認
        result_pre = await session.execute(select(Attendance).where(Attendance.user_id == user_id))
        assert len(result_pre.scalars().all()) == 1

        # 2. 退勤打刻 (2分後の 9:03:00) - クールダウン期間(60秒以上)は過ぎているが、5分以内
        punch_out_time = punch_in_time + timedelta(minutes=2)
        response_out = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "9999999999999999",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
            },
        )
        assert response_out.status_code == 200
        res_data = response_out.json()
        assert res_data["action"] == "cancelled"
        assert "取り消しました" in res_data["message"]

        # レコードが削除されている（0件）であることを確認
        session.expire_all()
        result_post = await session.execute(select(Attendance).where(Attendance.user_id == user_id))
        assert len(result_post.scalars().all()) == 0

    async def test_punch_cancel_respects_cooldown(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """出勤打刻から5分以内であっても、クールダウン期間内の打刻は409で拒否されること。"""
        user_id = "user-cancel-2"
        user = await _create_user(session, user_id=user_id)
        await _create_card(session, user.id, card_idm="8888888888888888")

        # 9:00〜18:00 のシフト
        shift_start = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        shift_end = datetime(2026, 5, 16, 18, 0, tzinfo=UTC)
        await _create_shift(
            session,
            user_id=user.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-cancel-2",
        )

        # 1. 出勤打刻 (9:01:00)
        punch_in_time = datetime(2026, 5, 16, 9, 1, 0, tzinfo=UTC)
        response_in = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "8888888888888888",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )
        assert response_in.status_code == 200

        # 2. 退勤打刻 (15秒後) - 5分以内だが、クールダウン期間(60秒)未満
        punch_out_time = punch_in_time + timedelta(seconds=15)
        response_out = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "8888888888888888",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
            },
        )
        # クールダウンエラーになること
        assert response_out.status_code == 409
        assert response_out.json()["code"] == "PUNCH_COOLDOWN_ACTIVE"

        # レコードはまだ削除されていないことを確認
        session.expire_all()
        result = await session.execute(select(Attendance).where(Attendance.user_id == user_id))
        assert len(result.scalars().all()) == 1

    async def test_punch_cancel_followed_by_cooldown_rejection(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """出勤打刻の取り消し直後の打刻がクールダウンによって拒否されること。"""
        user_id = "user-cancel-cooldown"
        user = await _create_user(session, user_id=user_id)

        # クールダウンを明示的に 60 秒に設定
        from kint.models.system_setting import SystemSetting

        session.add(
            SystemSetting(
                key="punch_cooldown_seconds",
                value="60",
                updated_by_user_id=user.id,
            )
        )
        await session.commit()

        await _create_card(session, user.id, card_idm="7777777777777777")

        # 9:00〜18:00 のシフトを作成
        shift_start = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        shift_end = datetime(2026, 5, 16, 18, 0, tzinfo=UTC)
        await _create_shift(
            session,
            user_id=user.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-cancel-cooldown",
        )

        # 1. 出勤打刻 (9:01:00) -> 200 OK
        punch_in_time = datetime(2026, 5, 16, 9, 1, 0, tzinfo=UTC)
        resp1 = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "7777777777777777",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )
        assert resp1.status_code == 200
        assert resp1.json()["action"] == "check_in"

        # 2. 2分後 (9:03:00) に打刻 (5分以内なので取り消し) -> 200 OK
        punch_cancel_time = punch_in_time + timedelta(minutes=2)
        resp2 = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "7777777777777777",
                "device_id": "web-browser",
                "occurred_at": punch_cancel_time.isoformat(),
            },
        )
        assert resp2.status_code == 200
        assert resp2.json()["action"] == "cancelled"

        # DB 上の勤怠レコードが削除された（0件）であることを確認
        session.expire_all()
        result = await session.execute(select(Attendance).where(Attendance.user_id == user_id))
        assert len(result.scalars().all()) == 0

        # 3. 取り消し直後 (20秒後 = 9:03:20) に再度打刻 -> クールダウン中(60秒以内)なので 409
        punch_consecutive_time = punch_cancel_time + timedelta(seconds=20)
        resp3 = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "7777777777777777",
                "device_id": "web-browser",
                "occurred_at": punch_consecutive_time.isoformat(),
            },
        )
        assert resp3.status_code == 409
        assert resp3.json()["code"] == "PUNCH_COOLDOWN_ACTIVE"

    async def test_overtime_punch_requires_reason(
        self,
        client: AsyncClient,
        session: AsyncSession,
    ) -> None:
        """シフト終了時間を超過して退勤打刻する際、超過理由を求められること。また、超過理由を指定して打刻した場合は丸めが回避されること。"""
        user = await _create_user(session, user_id="user-overtime")
        await _create_card(session, user.id, card_idm="8888888888888888")

        # 9:00〜18:00 のシフトを作成
        shift_start = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        shift_end = datetime(2026, 5, 16, 18, 0, tzinfo=UTC)
        await _create_shift(
            session,
            user_id=user.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-overtime",
        )

        # 出勤打刻 (9:00)
        punch_in_time = datetime(2026, 5, 16, 9, 0, tzinfo=UTC)
        await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "8888888888888888",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )

        # 退勤打刻 (18:40) -> 許容時間 (デフォルト30分) を超えているため requires_overtime_reason が返るはず
        punch_out_time = datetime(2026, 5, 16, 18, 40, tzinfo=UTC)
        resp1 = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "8888888888888888",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
            },
        )
        assert resp1.status_code == 200
        assert resp1.json()["status"] == "requires_overtime_reason"

        # 超過理由を指定して再度退勤打刻
        resp2 = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "8888888888888888",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
                "overtime_reason": "会議が長引いたため",
            },
        )
        assert resp2.status_code == 200
        assert resp2.json()["status"] == "completed"
        assert resp2.json()["action"] == "check_out"
        # 18:40 は 5分切り上げで 18:40
        assert resp2.json()["calculated_time"].startswith("2026-05-16T18:40:00")

        # DB のレコードを確認
        session.expire_all()
        result = await session.execute(select(Attendance).where(Attendance.user_id == "user-overtime"))
        att = result.scalars().one()
        assert att.overtime_reason == "会議が長引いたため"

        # 5. 超過申請をせず、通常の丸め（シフト終了時刻への切り下げ）を適用して退勤打刻するケース
        user_no_ot = await _create_user(session, user_id="user-no-overtime-apply")
        await _create_card(session, user_no_ot.id, card_idm="9999999999999999")
        await _create_shift(
            session,
            user_id=user_no_ot.id,
            start_time=shift_start,
            end_time=shift_end,
            event_id="event-no-overtime-apply",
        )

        # 出勤打刻 (9:00)
        await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "9999999999999999",
                "device_id": "web-browser",
                "occurred_at": punch_in_time.isoformat(),
            },
        )

        # 退勤打刻 (18:40) で confirm_no_overtime=True を指定
        resp_no_ot = await client.post(
            "/api/v1/punches",
            json={
                "card_idm": "9999999999999999",
                "device_id": "web-browser",
                "occurred_at": punch_out_time.isoformat(),
                "confirm_no_overtime": True,
            },
        )
        assert resp_no_ot.status_code == 200
        assert resp_no_ot.json()["status"] == "completed"
        # シフト終了時刻(18:00)に丸められる
        assert resp_no_ot.json()["calculated_time"].startswith("2026-05-16T18:00:00")

        # DBの超過理由が None であることを確認
        session.expire_all()
        result_no_ot = await session.execute(
            select(Attendance).where(Attendance.user_id == "user-no-overtime-apply")
        )
        att_no_ot = result_no_ot.scalars().one()
        assert att_no_ot.overtime_reason is None
