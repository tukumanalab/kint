"""当日のシフト変更（打刻時の再同期・JST 日付・定期同期）のテスト。"""

from datetime import UTC, date, datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.attendance import Attendance
from kint.models.card import Card
from kint.models.shift import Shift
from kint.models.system_setting import SystemSetting
from kint.models.user import User

JST = timezone(timedelta(hours=9))
CARD_IDM = "5555555555555555"
FETCH = "kint.services.calendar_sync._fetch_ical_bytes"


def _today_jst() -> date:
    return datetime.now(JST).date()


def _jst(d: date, hour: int, minute: int = 0) -> datetime:
    """JST の日時を UTC aware datetime で返す。"""
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=JST).astimezone(UTC)


def _ical(events: list[tuple[str, datetime, datetime, str]]) -> bytes:
    """(uid, start, end, email) のリストから iCal を作る。"""
    body = "".join(
        f"BEGIN:VEVENT\nUID:{uid}\nDTSTART:{s.strftime('%Y%m%dT%H%M%SZ')}\n"
        f"DTEND:{e.strftime('%Y%m%dT%H%M%SZ')}\n"
        f"ATTENDEE;ROLE=REQ-PARTICIPANT:MAILTO:{email}\nEND:VEVENT\n"
        for uid, s, e, email in events
    )
    return f"BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n{body}END:VCALENDAR\n".encode()


async def _setup(session: AsyncSession, with_url: bool = True) -> User:
    """従業員・カード・iCal URL 設定を作る。"""
    user = User(
        id="emp-sd",
        name="sd",
        full_name="当日 変更",
        email="sd@example.com",
        role="employee",
        is_active=1,
        token_version=1,
    )
    session.add(user)
    session.add(Card(id="card-sd", user_id=user.id, card_idm=CARD_IDM, name="社員証", is_active=1))
    if with_url:
        session.add(
            SystemSetting(
                key="shift_ical_url",
                value="https://example.com/cal.ics",
                updated_by_user_id=user.id,
            )
        )
    await session.commit()
    return user


async def _add_shift(
    session: AsyncSession, user_id: str, uid: str, start: datetime, end: datetime
) -> None:
    session.add(
        Shift(
            id=f"shift-{uid}",
            user_id=user_id,
            shift_date=start.astimezone(JST).date(),
            start_time=start,
            end_time=end,
            google_event_id=uid,
        )
    )
    await session.commit()


async def _punch(client: AsyncClient, at: datetime, **extra: object) -> dict:
    resp = await client.post(
        "/api/v1/punches",
        json={
            "card_idm": CARD_IDM,
            "device_id": "web-browser",
            "occurred_at": at.isoformat(),
            **extra,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestPunchRefresh:
    async def test_check_in_uses_shift_moved_earlier(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """シフト開始を当日前倒し → 再同期して新しい開始時刻で丸める（確認なし）。"""
        user = await _setup(session)
        d = _today_jst()
        await _add_shift(session, user.id, "ev-1", _jst(d, 13), _jst(d, 17))
        ical = _ical([("ev-1", _jst(d, 10), _jst(d, 17), user.email)])

        with patch(FETCH, return_value=ical) as fetch:
            data = await _punch(client, _jst(d, 9, 55))

        assert fetch.call_count == 1
        assert data["status"] == "completed"
        assert data["action"] == "check_in"
        assert datetime.fromisoformat(data["calculated_time"]) == _jst(d, 10)

    async def test_check_in_with_shift_added_today(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """当日追加されたシフト → 「シフトなし」確認にならない。"""
        user = await _setup(session)
        d = _today_jst()
        ical = _ical([("ev-new", _jst(d, 10), _jst(d, 15), user.email)])

        with patch(FETCH, return_value=ical):
            data = await _punch(client, _jst(d, 10, 2))

        assert data["status"] == "completed"
        assert data["action"] == "check_in"

    async def test_check_out_with_shift_extended_today(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """当日延長されたシフト → 退勤時に超過理由を求めない。"""
        user = await _setup(session)
        d = _today_jst()
        await _add_shift(session, user.id, "ev-2", _jst(d, 10), _jst(d, 15))
        with patch(FETCH, side_effect=AssertionError("出勤時は取得不要")):
            await _punch(client, _jst(d, 10, 0))

        ical = _ical([("ev-2", _jst(d, 10), _jst(d, 18), user.email)])
        with patch(FETCH, return_value=ical) as fetch:
            data = await _punch(client, _jst(d, 17, 58))

        assert fetch.call_count == 1
        assert data["status"] == "completed"
        assert data["action"] == "check_out"
        assert datetime.fromisoformat(data["calculated_time"]) == _jst(d, 18)

    async def test_no_refetch_right_after_sync(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """直前に同期済みなら iCal を取り直さず、従来どおり確認を求める。"""
        user = await _setup(session)
        d = _today_jst()
        with patch(FETCH, return_value=_ical([])) as fetch:
            first = await _punch(client, _jst(d, 10))
            second = await _punch(client, _jst(d, 10, 1))
        assert fetch.call_count == 1
        assert first["status"] == "requires_confirmation"
        assert second["status"] == "requires_confirmation"
        _ = user

    async def test_fetch_failure_falls_back_to_existing_shift(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """iCal の取得に失敗しても打刻は止めず、既存のシフトで判定する。"""
        user = await _setup(session)
        d = _today_jst()
        await _add_shift(session, user.id, "ev-3", _jst(d, 13), _jst(d, 17))
        with patch(FETCH, side_effect=OSError("timeout")):
            data = await _punch(client, _jst(d, 12, 50))
        assert data["status"] == "completed"
        assert datetime.fromisoformat(data["calculated_time"]) == _jst(d, 13)

    async def test_no_fetch_when_url_not_set(
        self, client: AsyncClient, session: AsyncSession
    ) -> None:
        """iCal URL 未設定なら取得しない。"""
        await _setup(session, with_url=False)
        d = _today_jst()
        with patch(FETCH, side_effect=AssertionError("取得しないこと")):
            data = await _punch(client, _jst(d, 10))
        assert data["status"] == "requires_confirmation"


class TestShiftDateJst:
    async def test_early_morning_shift_uses_jst_date(self, session: AsyncSession) -> None:
        """JST 9 時前に始まるシフトは JST の日付で保存され、UTC 日付の既存行も修正される。"""
        from kint.services.calendar_sync import CalendarSyncService

        user = await _setup(session)
        d = _today_jst()
        start, end = _jst(d, 7), _jst(d, 12)
        # 旧実装の UTC 日付（前日）で保存された行
        session.add(
            Shift(
                id="shift-early",
                user_id=user.id,
                shift_date=start.date(),
                start_time=start,
                end_time=end,
                google_event_id="ev-early",
            )
        )
        await session.commit()
        assert start.date() != d

        with patch(FETCH, return_value=_ical([("ev-early", start, end, user.email)])):
            stats = await CalendarSyncService(session).sync()

        assert stats["updated"] == 1
        shift = (
            await session.execute(select(Shift).where(Shift.google_event_id == "ev-early"))
        ).scalar_one()
        assert shift.shift_date == d


class TestFaceShiftRefresh:
    async def test_face_shift_state_refreshes_when_no_shift(self, session: AsyncSession) -> None:
        """顔認証で一致距離内の候補にシフトがなければ再同期して判定する。"""
        from kint.services.face import FaceService

        user = await _setup(session)
        now = datetime.now(UTC)
        ical = _ical(
            [("ev-face", now - timedelta(minutes=30), now + timedelta(hours=2), user.email)]
        )
        with patch(FETCH, return_value=ical):
            _, has_shift = await FaceService(session)._get_shift_state(
                user.id, now, refresh_if_no_shift=True
            )
        assert has_shift is True

    async def test_face_shift_state_without_refresh_flag(self, session: AsyncSession) -> None:
        from kint.services.face import FaceService

        user = await _setup(session)
        with patch(FETCH, side_effect=AssertionError("取得しないこと")):
            _, has_shift = await FaceService(session)._get_shift_state(user.id, datetime.now(UTC))
        assert has_shift is False


class TestAutoCompleteRefresh:
    async def test_auto_complete_job_uses_latest_shift_end(self, session: AsyncSession) -> None:
        """補完ジョブは先にシフトを同期し、当日変更後の終了時刻で補完する。"""
        from kint import scheduler

        user = await _setup(session)
        d = _today_jst() - timedelta(days=1)
        await _add_shift(session, user.id, "ev-ac", _jst(d, 10), _jst(d, 15))
        session.add(
            Attendance(
                id="att-ac",
                user_id=user.id,
                work_date=d,
                check_in=_jst(d, 10),
                source="webusb_nfc",
            )
        )
        await session.commit()

        ical = _ical([("ev-ac", _jst(d, 10), _jst(d, 13), user.email)])
        session_cm = MagicMock()
        session_cm.__aenter__.return_value = session
        session_cm.__aexit__.return_value = None
        with (
            patch(FETCH, return_value=ical),
            patch.object(scheduler, "AsyncSessionLocal", return_value=session_cm),
        ):
            await scheduler._run_missing_checkout_auto_complete()

        att = (
            await session.execute(select(Attendance).where(Attendance.id == "att-ac"))
        ).scalar_one()
        await session.refresh(att)
        assert att.check_out is not None
        assert att.check_out.replace(tzinfo=UTC) == _jst(d, 13)
