"""勤務時間報告書機能のテスト。"""

from datetime import date, datetime
import logging
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

logging.getLogger("aiosqlite").setLevel(logging.WARNING)

from kint.models.attendance import Attendance
from kint.models.user import User
from kint.schemas.settings import SettingsPatchRequest
from kint.services.attendance import AttendanceService
from kint.services.settings import SettingsService


@pytest.mark.asyncio
async def test_get_working_hours_report_data(session: AsyncSession):
    """勤務時間報告書データの取得と時間計算の精度を検証。"""
    user = User(
        id="user-rpt-1",
        name="testuser",
        full_name="山田 太郎",
        name_kana="ヤマダ タロウ",
        department="研究開発部",
        worker_id="EMP-001",
        email="yamada@example.com",
        role="employee",
    )
    session.add(user)
    await session.commit()

    from datetime import timezone
    UTC = timezone.utc

    # 2026-07-01 に JST 13:00〜18:00 (UTC 04:00〜09:00, 休憩0分) の勤怠記録を作成
    att1 = Attendance(
        id="att-rpt-1",
        user_id="user-rpt-1",
        work_date=date(2026, 7, 1),
        check_in=datetime(2026, 7, 1, 4, 0, 0, tzinfo=UTC),
        check_out=datetime(2026, 7, 1, 9, 0, 0, tzinfo=UTC),
        work_start=datetime(2026, 7, 1, 4, 0, 0, tzinfo=UTC),
        work_end=datetime(2026, 7, 1, 9, 0, 0, tzinfo=UTC),
        break_minutes=0,
        source="webusb_nfc",
    )
    # 2026-07-07 に JST 13:00〜15:00, 16:00〜18:00 (2枠) の勤怠記録を作成
    att2 = Attendance(
        id="att-rpt-2",
        user_id="user-rpt-1",
        work_date=date(2026, 7, 7),
        check_in=datetime(2026, 7, 7, 4, 0, 0, tzinfo=UTC),
        check_out=datetime(2026, 7, 7, 6, 0, 0, tzinfo=UTC),
        work_start=datetime(2026, 7, 7, 4, 0, 0, tzinfo=UTC),
        work_end=datetime(2026, 7, 7, 6, 0, 0, tzinfo=UTC),
        break_minutes=0,
        source="webusb_nfc",
    )
    att3 = Attendance(
        id="att-rpt-3",
        user_id="user-rpt-1",
        work_date=date(2026, 7, 7),
        check_in=datetime(2026, 7, 7, 7, 0, 0, tzinfo=UTC),
        check_out=datetime(2026, 7, 7, 9, 0, 0, tzinfo=UTC),
        work_start=datetime(2026, 7, 7, 7, 0, 0, tzinfo=UTC),
        work_end=datetime(2026, 7, 7, 9, 0, 0, tzinfo=UTC),
        break_minutes=0,
        source="webusb_nfc",
    )
    # 2026-07-08 に JST 13:00〜20:00 (UTC 04:00〜11:00, 休憩60分) の勤怠記録を作成
    att4 = Attendance(
        id="att-rpt-4",
        user_id="user-rpt-1",
        work_date=date(2026, 7, 8),
        check_in=datetime(2026, 7, 8, 4, 0, 0, tzinfo=UTC),
        check_out=datetime(2026, 7, 8, 11, 0, 0, tzinfo=UTC),
        work_start=datetime(2026, 7, 8, 4, 0, 0, tzinfo=UTC),
        work_end=datetime(2026, 7, 8, 11, 0, 0, tzinfo=UTC),
        break_minutes=60,
        source="webusb_nfc",
    )

    # 2026-07-09 に JST 13:00〜13:15 (UTC 04:00〜04:15, 実時間15分) の勤怠記録を作成
    att5 = Attendance(
        id="att-rpt-5",
        user_id="user-rpt-1",
        work_date=date(2026, 7, 9),
        check_in=datetime(2026, 7, 9, 4, 0, 0, tzinfo=UTC),
        check_out=datetime(2026, 7, 9, 4, 15, 0, tzinfo=UTC),
        work_start=datetime(2026, 7, 9, 4, 0, 0, tzinfo=UTC),
        work_end=datetime(2026, 7, 9, 4, 15, 0, tzinfo=UTC),
        break_minutes=0,
        source="webusb_nfc",
    )

    # 2026-07-10 に 打刻のみ (check_in/check_out はあるが work_start/work_end は None) の勤怠記録を作成
    att6 = Attendance(
        id="att-rpt-6",
        user_id="user-rpt-1",
        work_date=date(2026, 7, 10),
        check_in=datetime(2026, 7, 10, 4, 0, 0, tzinfo=UTC),
        check_out=datetime(2026, 7, 10, 5, 0, 0, tzinfo=UTC),
        work_start=None,
        work_end=None,
        break_minutes=0,
        source="webusb_nfc",
    )

    # 2026-07-03 に 打刻があるが削除された記録 (is_manual_work_time=True かつ work_start/work_end=None) を作成
    att7 = Attendance(
        id="att-rpt-7",
        user_id="user-rpt-1",
        work_date=date(2026, 7, 3),
        check_in=datetime(2026, 7, 3, 23, 0, 0),
        check_out=datetime(2026, 7, 4, 14, 11, 0),
        work_start=None,
        work_end=None,
        break_minutes=60,
        is_manual_work_time=True,
        source="webusb_nfc",
    )

    session.add_all([att1, att2, att3, att4, att5, att6, att7])
    await session.commit()

    service = AttendanceService(session)
    report = await service.get_working_hours_report_data(year_month="2026-07", user_id="user-rpt-1")

    assert report.year == 2026
    assert report.month == 7
    assert report.user.full_name == "山田 太郎"
    assert report.user.department == "研究開発部"
    assert report.user.worker_id == "EMP-001"
    assert report.user.name_kana == "ヤマダ タロウ"

    # 31日分 + 7日の追加分1行 = 32行
    assert len(report.days) == 32

    # 実時間合計: 5h + 2h + 2h + 6h + 15m + 1h(att6) = 16h15m -> "(16:15)"
    assert report.total_actual_work_time_str == "(16:15)"
    # 申請時間合計 (Web画面サマリーと完全一致: 実時間16h15m=16.25hを30分繰り上げ): 16.5
    assert report.total_requested_work_hours == 16.5

    # 1日目の確認
    day1 = [d for d in report.days if d.date == date(2026, 7, 1)][0]
    assert day1.day_of_week_label == "1(水)"
    assert day1.start_time == "13:00"
    assert day1.end_time == "18:00"
    assert day1.actual_work_time_str == "5:00"
    assert day1.work_content == "青学つくまなラボ 利用者対応"
    assert day1.remarks is None

    # 3日目(手動削除された記録)の確認 -> 報告書には時刻・勤務内容が出力されず空欄であること
    day3 = [d for d in report.days if d.date == date(2026, 7, 3)][0]
    assert day3.start_time is None
    assert day3.end_time is None
    assert day3.actual_work_time_str is None
    assert day3.work_content is None


@pytest.mark.asyncio
async def test_deleted_attendance_record_excluded_from_report(session: AsyncSession):
    """手動削除された勤務記録 (is_manual_work_time=True かつ work_start/work_end=None) が報告書から除外されることを検証。"""
    user = User(
        id="user-del-test",
        name="deluser",
        full_name="削除 テスト",
        email="del@example.com",
        role="employee",
    )
    session.add(user)
    await session.commit()

    # 2026-07-03: 打刻はあるが管理者操作で勤務時間が削除されたレコード (スクリーンショットのケース)
    att_deleted = Attendance(
        id="att-deleted-1",
        user_id="user-del-test",
        work_date=date(2026, 7, 3),
        check_in=datetime(2026, 7, 3, 23, 0, 0),
        check_out=datetime(2026, 7, 4, 14, 11, 0),
        work_start=None,
        work_end=None,
        break_minutes=60,
        is_manual_work_time=True,
        source="webusb_nfc",
    )
    session.add(att_deleted)
    await session.commit()

    service = AttendanceService(session)
    report = await service.get_working_hours_report_data(year_month="2026-07", user_id="user-del-test")

    # 07-03 の明細を取得
    day3 = [d for d in report.days if d.date == date(2026, 7, 3)][0]
    assert day3.start_time is None
    assert day3.end_time is None
    assert day3.actual_work_time_str is None
    assert day3.work_content is None
    assert day3.remarks is None


@pytest.mark.asyncio
async def test_working_hours_report_summary_consistency(session: AsyncSession):
    """Web画面の月次勤務サマリーと報告書データの集計値（申請勤務時間・実時間）が完全一致することを検証。"""
    user = User(
        id="user-cons-1",
        name="consuser",
        full_name="一致 テスト",
        email="cons@example.com",
        role="employee",
    )
    session.add(user)
    await session.commit()

    # 勤怠データ作成 (3時間45分 = 3.75時間)
    att = Attendance(
        id="att-cons-1",
        user_id="user-cons-1",
        work_date=date(2026, 7, 10),
        check_in=datetime(2026, 7, 10, 9, 0, 0),
        check_out=datetime(2026, 7, 10, 12, 45, 0),
        work_start=datetime(2026, 7, 10, 9, 0, 0),
        work_end=datetime(2026, 7, 10, 12, 45, 0),
        break_minutes=0,
        source="webusb_nfc",
    )
    session.add(att)
    await session.commit()

    service = AttendanceService(session)
    # 月次サマリーの取得
    period_data, _ = await service._calculate_period_data(
        from_date=date(2026, 7, 1), to_date=date(2026, 7, 31), user_id="user-cons-1"
    )
    _, summary, _ = period_data[0]

    # 報告書データの取得
    report = await service.get_working_hours_report_data(year_month="2026-07", user_id="user-cons-1")

    # 1. Webサマリーの「申請勤務時間」 == 報告書の「計算欄」
    assert report.total_requested_work_hours == summary.total_requested_hours

    # 2. Webサマリーの「実時間」 (3.75h -> 3:45) == 報告書の「合計時間数」 "(3:45)"
    assert report.total_actual_work_time_str == "(3:45)"
    assert int(round(summary.total_working_hours * 60)) == 225  # 225分 = 3時間45分


@pytest.mark.asyncio
async def test_working_hours_report_custom_default_content(session: AsyncSession):
    """システム設定のデフォルト勤務内容の変更が報告書に反映されることを検証。"""
    user = User(
        id="user-content-1",
        name="contentuser",
        full_name="勤務内容 テスト",
        email="content@example.com",
        role="employee",
    )
    session.add(user)
    await session.commit()

    # システム設定のデフォルト勤務内容を変更
    settings_svc = SettingsService(session)
    await settings_svc.upsert(
        SettingsPatchRequest(working_report_default_content="研究室ラボ サポート業務"),
        actor_id="user-content-1",
    )

    # 勤怠データ作成
    att = Attendance(
        id="att-content-1",
        user_id="user-content-1",
        work_date=date(2026, 7, 15),
        check_in=datetime(2026, 7, 15, 10, 0, 0),
        check_out=datetime(2026, 7, 15, 15, 0, 0),
        work_start=datetime(2026, 7, 15, 10, 0, 0),
        work_end=datetime(2026, 7, 15, 15, 0, 0),
        break_minutes=0,
        source="webusb_nfc",
    )
    session.add(att)
    await session.commit()

    service = AttendanceService(session)
    report = await service.get_working_hours_report_data(year_month="2026-07", user_id="user-content-1")

    day15 = [d for d in report.days if d.date == date(2026, 7, 15)][0]
    assert day15.work_content == "研究室ラボ サポート業務"
    assert day15.remarks is None


@pytest.mark.asyncio
async def test_working_hours_report_local_timezone(session: AsyncSession):
    """UTC で保存された時刻がローカルタイム (JST +09:00) の HH:MM 表記で報告書に出力されることを検証。"""
    from datetime import timezone, timedelta
    UTC = timezone.utc
    user = User(
        id="user-tz-1",
        name="tzuser",
        full_name="タイムゾーン テスト",
        email="tz@example.com",
        role="employee",
    )
    session.add(user)
    await session.commit()

    # UTC 04:00 (JST 13:00) 〜 UTC 09:00 (JST 18:00) の勤務データを登録
    att = Attendance(
        id="att-tz-1",
        user_id="user-tz-1",
        work_date=date(2026, 7, 20),
        check_in=datetime(2026, 7, 20, 4, 0, 0, tzinfo=UTC),
        check_out=datetime(2026, 7, 20, 9, 0, 0, tzinfo=UTC),
        work_start=datetime(2026, 7, 20, 4, 0, 0, tzinfo=UTC),
        work_end=datetime(2026, 7, 20, 9, 0, 0, tzinfo=UTC),
        break_minutes=0,
        source="webusb_nfc",
    )
    session.add(att)
    await session.commit()

    service = AttendanceService(session)
    report = await service.get_working_hours_report_data(year_month="2026-07", user_id="user-tz-1")

    day20 = [d for d in report.days if d.date == date(2026, 7, 20)][0]
    # UTC 04:00 -> JST 13:00, UTC 09:00 -> JST 18:00
    assert day20.start_time == "13:00"
    assert day20.end_time == "18:00"


@pytest.mark.asyncio
async def test_working_hours_report_endpoint(client: AsyncClient, session: AsyncSession):
    """API エンドポイントのアクセス権限とレスポンスの検証。"""
    user = User(
        id="emp-1",
        name="emp1",
        full_name="従業員 一郎",
        email="emp1@example.com",
        role="employee",
    )
    admin = User(
        id="admin-1",
        name="admin1",
        full_name="管理者 次郎",
        email="admin1@example.com",
        role="admin",
    )
    session.add_all([user, admin])
    await session.commit()

    # JWT トークン生成
    from kint.routers.auth import _create_access_token
    token_emp = _create_access_token("emp-1", 1)
    token_admin = _create_access_token("admin-1", 1)

    # 1. 従業員が自分の報告書を取得 -> OK
    res = await client.get(
        "/api/v1/attendance/working-hours-report?year_month=2026-07",
        headers={"Authorization": f"Bearer {token_emp}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["user"]["full_name"] == "従業員 一郎"
    assert data["total_actual_work_time_str"] == "(0:00)"

    # 2. 従業員が管理者の報告書を取得 -> 403 Forbidden
    res = await client.get(
        "/api/v1/attendance/working-hours-report?year_month=2026-07&user_id=admin-1",
        headers={"Authorization": f"Bearer {token_emp}"},
    )
    assert res.status_code == 403

    # 3. 管理者が従業員の報告書を取得 -> OK
    res = await client.get(
        "/api/v1/attendance/working-hours-report?year_month=2026-07&user_id=emp-1",
        headers={"Authorization": f"Bearer {token_admin}"},
    )
    assert res.status_code == 200
    assert res.json()["user"]["full_name"] == "従業員 一郎"
