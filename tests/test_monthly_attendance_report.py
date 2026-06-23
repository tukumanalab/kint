import pytest
from datetime import date, datetime, UTC
from unittest.mock import patch, MagicMock

from kint.models.user import User
from kint.models.shift import Shift
from kint.models.attendance import Attendance
from kint.services.attendance import AttendanceService

pytestmark = pytest.mark.asyncio


async def _create_user(session, **kwargs) -> User:
    defaults = {
        "is_active": 1,
        "token_version": 1,
    }
    defaults.update(kwargs)
    user = User(**defaults)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


import uuid

async def _create_shift(session, user_id: str, shift_date: date, start_hour: int, end_hour: int) -> Shift:
    shift_id = str(uuid.uuid4())
    shift = Shift(
        id=shift_id,
        user_id=user_id,
        shift_date=shift_date,
        start_time=datetime(shift_date.year, shift_date.month, shift_date.day, start_hour, 0, tzinfo=UTC),
        end_time=datetime(shift_date.year, shift_date.month, shift_date.day, end_hour, 0, tzinfo=UTC),
        google_event_id=f"g_event_{shift_id}",
    )
    session.add(shift)
    await session.commit()
    return shift


async def _create_attendance(session, user_id: str, work_date: date, in_hour: int, out_hour: int) -> Attendance:
    att = Attendance(
        id=str(uuid.uuid4()),
        user_id=user_id,
        work_date=work_date,
        check_in=datetime(work_date.year, work_date.month, work_date.day, in_hour, 0, tzinfo=UTC),
        check_out=datetime(work_date.year, work_date.month, work_date.day, out_hour, 0, tzinfo=UTC),
        source="webusb_nfc",
    )
    session.add(att)
    await session.commit()
    return att


@patch("kint.services.gmail.GmailAdapter.send_email")
async def test_send_monthly_attendance_reports(mock_send_email, session) -> None:
    # 1. ユーザーの準備 (管理者、従業員1, 従業員2)
    # 管理者
    admin_user = await _create_user(
        session,
        id="admin_user",
        name="管理者",
        full_name="System Admin",
        email="admin@example.com",
        role="admin",
    )

    # システム設定で site_name を設定
    from kint.models.system_setting import SystemSetting
    setting = SystemSetting(
        key="site_name",
        value="つくまな勤怠",
        updated_by_user_id=admin_user.id,
    )
    session.add(setting)
    await session.commit()
    # 従業員1 (メールアドレスあり)
    emp1 = await _create_user(
        session,
        id="employee1",
        name="従業員1",
        full_name="Employee One",
        email="emp1@example.com",
        role="employee",
    )
    # 従業員2 (メールアドレスあり)
    emp2 = await _create_user(
        session,
        id="employee2",
        name="従業員2",
        full_name="Employee Two",
        email="emp2@example.com",
        role="employee",
    )
    # 従業員3 (メールアドレス空文字列)
    emp3 = await _create_user(
        session,
        id="employee3",
        name="従業員3",
        full_name="Employee Three",
        email="",
        role="employee",
    )

    # 2. シフトと勤務記録の準備
    # 従業員1: 
    # 5月 (5/15): 8時間勤務 (9:00 - 17:00)
    # 6月 (6/10, 6/20): 各8時間勤務 (9:00 - 17:00)
    # 総労働時間: 5月=8h, 6月=16h, 1月からの累計=24h, 勤務日数: 6月=2日
    await _create_shift(session, emp1.id, date(2026, 5, 15), 9, 17)
    await _create_attendance(session, emp1.id, date(2026, 5, 15), 9, 17)

    await _create_shift(session, emp1.id, date(2026, 6, 10), 9, 17)
    await _create_attendance(session, emp1.id, date(2026, 6, 10), 9, 17)
    await _create_shift(session, emp1.id, date(2026, 6, 20), 9, 17)
    await _create_attendance(session, emp1.id, date(2026, 6, 20), 9, 17)

    # 従業員2:
    # 6月 (6/15): 8時間勤務 (9:00 - 17:00)
    # 総労働時間: 5月=0h, 6月=8h, 1月からの累計=8h, 勤務日数: 6月=1日
    await _create_shift(session, emp2.id, date(2026, 6, 15), 9, 17)
    await _create_attendance(session, emp2.id, date(2026, 6, 15), 9, 17)

    # 管理者: (勤務記録を登録しておくが、メール送信は除外されるはず)
    await _create_shift(session, admin_user.id, date(2026, 6, 15), 9, 17)
    await _create_attendance(session, admin_user.id, date(2026, 6, 15), 9, 17)

    # 3. サービスの実行
    service = AttendanceService(session)
    # 2026年6月30日（月末日）を対象として実行
    await service.send_monthly_attendance_reports(date(2026, 6, 30))

    # 4. アサーション (管理者は除外され、メールアドレスがないユーザーも除外され、合計2通の送信が発生すること)
    assert mock_send_email.call_count == 2

    # 各呼び出しの引数を確認
    calls = mock_send_email.call_args_list
    sent_emails = [call[0][0] for call in calls]
    
    assert "emp1@example.com" in sent_emails
    assert "emp2@example.com" in sent_emails
    assert "admin@example.com" not in sent_emails

    # 各メールの本文のアサーション
    for call in calls:
        to_email = call[0][0]
        subject = call[0][1]
        body = call[0][2]

        assert subject == "【つくまな勤怠】2026年6月 勤務実績レポート"
        assert "つくまな勤怠 勤怠管理システムより、当月の勤務実績レポートをお知らせします。" in body
        
        if to_email == "emp1@example.com":
            assert "Employee One さん" in body
            assert "1か月ごとの勤務日数: 2 日" in body
            assert "1か月ごとの勤務時間: 16:00" in body
            assert "1月からの総勤務時間: 24:00" in body
        elif to_email == "emp2@example.com":
            assert "Employee Two さん" in body
            assert "1か月ごとの勤務日数: 1 日" in body
            assert "1か月ごとの勤務時間: 8:00" in body
            assert "1月からの総勤務時間: 8:00" in body
