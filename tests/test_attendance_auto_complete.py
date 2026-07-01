"""自動退勤補完の単体テスト。"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.attendance import Attendance, AttendanceChangeLog
from kint.models.shift import Shift
from kint.models.user import User
from kint.services.attendance import AttendanceService


async def _create_user(session: AsyncSession, user_id: str = "user-test-01") -> User:
    user = User(
        id=user_id,
        name="testuser",
        full_name="テストユーザー",
        email=f"{user_id}@example.com",
        role="employee",
        is_active=1,
        token_version=1,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _create_shift(
    session: AsyncSession,
    *,
    user_id: str,
    shift_date: date,
    start_time: datetime,
    end_time: datetime,
) -> Shift:
    shift = Shift(
        id=f"shift-{user_id}-{shift_date.isoformat()}",
        user_id=user_id,
        shift_date=shift_date,
        start_time=start_time,
        end_time=end_time,
        google_event_id=f"event-{user_id}-{shift_date.isoformat()}",
    )
    session.add(shift)
    await session.commit()
    await session.refresh(shift)
    return shift


@pytest.mark.asyncio
async def test_auto_complete_missing_checkouts(session: AsyncSession) -> None:
    """退勤忘れ自動補完の挙動テスト。

    - 前日以前でシフトがある場合はシフト終了時刻で補完されること。
    - 前日以前でシフトがない場合は補完されず incomplete のままであること。
    - 当日の未退勤レコードは補完対象外となること。
    - 補完時に system ユーザーによる監査ログが作成されること。
    """
    service = AttendanceService(session)
    user = await _create_user(session, "user-auto-01")

    # 1. シフトがある前日の未退勤レコード（補完対象）
    yesterday = date.today() - timedelta(days=1)
    shift_start = datetime.combine(yesterday, datetime.min.time()).replace(hour=9, tzinfo=UTC)
    shift_end = datetime.combine(yesterday, datetime.min.time()).replace(hour=18, tzinfo=UTC)
    await _create_shift(
        session, user_id=user.id, shift_date=yesterday, start_time=shift_start, end_time=shift_end
    )

    att_yesterday_with_shift = Attendance(
        id="att-y-with-shift",
        user_id=user.id,
        card_idm="0000000000000001",
        work_date=yesterday,
        check_in=datetime.combine(yesterday, datetime.min.time()).replace(
            hour=8, minute=55, tzinfo=UTC
        ),
        check_out=None,
        source="webusb_nfc",
    )
    session.add(att_yesterday_with_shift)

    # 2. シフトがない一昨日の未退勤レコード（補完対象外・スキップ）
    two_days_ago = date.today() - timedelta(days=2)
    att_yesterday_no_shift = Attendance(
        id="att-y-no-shift",
        user_id=user.id,
        card_idm="0000000000000001",
        work_date=two_days_ago,
        check_in=datetime.combine(two_days_ago, datetime.min.time()).replace(
            hour=9, minute=0, tzinfo=UTC
        ),
        check_out=None,
        source="webusb_nfc",
    )
    session.add(att_yesterday_no_shift)

    # 3. シフトがある当日の未退勤レコード（本日中のため、補完対象外・クエリ抽出対象外）
    today = date.today()
    shift_start_today = datetime.combine(today, datetime.min.time()).replace(hour=9, tzinfo=UTC)
    shift_end_today = datetime.combine(today, datetime.min.time()).replace(hour=18, tzinfo=UTC)
    await _create_shift(
        session,
        user_id=user.id,
        shift_date=today,
        start_time=shift_start_today,
        end_time=shift_end_today,
    )

    att_today_with_shift = Attendance(
        id="att-t-with-shift",
        user_id=user.id,
        card_idm="0000000000000001",
        work_date=today,
        check_in=datetime.combine(today, datetime.min.time()).replace(
            hour=8, minute=50, tzinfo=UTC
        ),
        check_out=None,
        source="webusb_nfc",
    )
    session.add(att_today_with_shift)

    # 4. シフト終了予定時刻よりも後にチェックインした前日レコード（補完対象外・スキップ）
    # シフト終了: 18:00 (UTC 18:00 とするが、shift_endはhour=18 UTCで作成されているので18:00)
    # チェックイン: 18:30
    att_yesterday_late_checkin = Attendance(
        id="att-y-late-checkin",
        user_id=user.id,
        card_idm="0000000000000001",
        work_date=yesterday,
        check_in=datetime.combine(yesterday, datetime.min.time()).replace(
            hour=18, minute=30, tzinfo=UTC
        ),
        check_out=None,
        source="webusb_nfc",
    )
    session.add(att_yesterday_late_checkin)

    await session.commit()

    # 自動補完メソッドを実行
    stats = await service.auto_complete_missing_checkouts()

    # 補完統計の検証
    assert stats["processed"] == 1
    assert stats["skipped"] == 2

    # 各レコードの状態を検証
    # 1. 補完された前日レコード（シフトあり）
    res1 = await session.execute(select(Attendance).where(Attendance.id == "att-y-with-shift"))
    att1 = res1.scalar_one()
    # シフト終了時刻で補完されていること
    assert att1.check_out.replace(tzinfo=None) == shift_end.replace(tzinfo=None)
    assert att1.is_auto_completed is True
    assert att1.auto_completed_at is not None
    assert att1.last_updated_by_user_id == "system"

    # 監査ログが作成されていること
    res_log = await session.execute(
        select(AttendanceChangeLog).where(AttendanceChangeLog.attendance_id == "att-y-with-shift")
    )
    logs = res_log.scalars().all()
    assert len(logs) == 1
    assert logs[0].actor_user_id == "system"
    assert logs[0].after_check_out.replace(tzinfo=None) == shift_end.replace(tzinfo=None)
    assert logs[0].reason == "退勤忘れのためシフト終了時刻でシステム自動補完"

    # 2. 補完されなかった前日レコード（シフトなし）
    res2 = await session.execute(select(Attendance).where(Attendance.id == "att-y-no-shift"))
    att2 = res2.scalar_one()
    assert att2.check_out is None
    assert att2.is_auto_completed is False

    # 3. 補完されなかった当日レコード（本日中）
    res3 = await session.execute(select(Attendance).where(Attendance.id == "att-t-with-shift"))
    att3 = res3.scalar_one()
    assert att3.check_out is None
    assert att3.is_auto_completed is False

    # 4. 補完されなかった前日レコード（シフト終了時刻以前にチェックイン）
    res4 = await session.execute(select(Attendance).where(Attendance.id == "att-y-late-checkin"))
    att4 = res4.scalar_one()
    assert att4.check_out is None
    assert att4.is_auto_completed is False
