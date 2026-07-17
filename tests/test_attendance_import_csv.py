"""勤務時間報告書 CSV インポート機能のテスト。"""

from datetime import date, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.attendance import Attendance
from kint.models.user import User
from kint.services.attendance import AttendanceService


@pytest.mark.asyncio
async def test_import_csv_report_success_and_upsert(session: AsyncSession) -> None:
    """CSVインポートが成功し、氏名の空白が無視され、重複データが上書きされることをテスト。"""
    # テストユーザー作成
    admin = User(
        id="user-admin",
        name="管理者",
        full_name="管理者 太郎",
        email="admin@example.com",
        role="admin",
        is_active=1,
    )
    user1 = User(
        id="user-1",
        name="choiminju",
        full_name="CHOI MINJU",
        email="choi@example.com",
        role="employee",
        is_active=1,
    )
    user2 = User(
        id="user-2",
        name="sato_ren",
        full_name="佐藤 蓮",
        email="sato@example.com",
        role="employee",
        is_active=1,
    )
    session.add_all([admin, user1, user2])
    await session.commit()

    # CSVデータ (全角・半角スペース入り氏名)
    csv_text = (
        "氏名,勤務開始日時,勤務終了日時,実働時間数\n"
        "CHOI  MINJU,2026/04/07 13:00:00,2026/04/07 18:00:00,5:00:00\n"
        "佐 藤　蓮,2026/04/07 13:00:00,2026/04/07 17:30:00,4:30:00\n"
    )

    service = AttendanceService(session)
    res = await service.import_csv_report(csv_text.encode("utf-8"), admin)

    assert res.total_rows == 2
    assert res.imported_count == 2
    assert res.created_count == 2
    assert res.updated_count == 0
    assert res.unmatched_names == []
    assert res.errors == []

    # DBレコードの検証 (JST 13:00 -> UTC 04:00)
    att1 = (
        await session.execute(
            select(Attendance).where(
                Attendance.user_id == "user-1",
                Attendance.work_date == date(2026, 4, 7),
            )
        )
    ).scalar_one_or_none()
    assert att1 is not None
    assert att1.check_in == datetime(2026, 4, 7, 4, 0, 0)
    assert att1.check_out == datetime(2026, 4, 7, 9, 0, 0)
    assert att1.work_start == datetime(2026, 4, 7, 4, 0, 0)
    assert att1.work_end == datetime(2026, 4, 7, 9, 0, 0)
    assert att1.is_manual_work_time is True

    att2 = (
        await session.execute(
            select(Attendance).where(
                Attendance.user_id == "user-2",
                Attendance.work_date == date(2026, 4, 7),
            )
        )
    ).scalar_one_or_none()
    assert att2 is not None
    assert att2.check_in == datetime(2026, 4, 7, 4, 0, 0)
    assert att2.check_out == datetime(2026, 4, 7, 8, 30, 0)

    # 再度同じ日付で上書きインポートをテスト (時間変更 JST 14:00->UTC 05:00)
    csv_text_update = (
        "氏名,勤務開始日時,勤務終了日時,実働時間数\n"
        "CHOIMINJU,2026/04/07 14:00:00,2026/04/07 19:00:00,5:00:00\n"
    )
    res2 = await service.import_csv_report(csv_text_update.encode("utf-8"), admin)
    assert res2.total_rows == 1
    assert res2.imported_count == 1
    assert res2.created_count == 0
    assert res2.updated_count == 1

    await session.refresh(att1)
    assert att1.check_in == datetime(2026, 4, 7, 5, 0, 0)
    assert att1.check_out == datetime(2026, 4, 7, 10, 0, 0)


@pytest.mark.asyncio
async def test_import_csv_unmatched_user(session: AsyncSession) -> None:
    """登録アカウントに名前が見つからない場合に報告されることをテスト。"""
    admin = User(
        id="user-admin",
        name="管理者",
        full_name="管理者 太郎",
        email="admin@example.com",
        role="admin",
        is_active=1,
    )
    session.add(admin)
    await session.commit()

    csv_text = (
        "氏名,勤務開始日時,勤務終了日時,実働時間数\n"
        "未登録 太郎,2026/04/07 13:00:00,2026/04/07 18:00:00,5:00:00\n"
    )

    service = AttendanceService(session)
    res = await service.import_csv_report(csv_text.encode("utf-8"), admin)

    assert res.total_rows == 1
    assert res.imported_count == 0
    assert res.unmatched_names == ["未登録 太郎"]
    assert len(res.unmatched_rows) == 1
    assert res.unmatched_rows[0].raw_name == "未登録 太郎"
    assert res.unmatched_rows[0].normalized_name == "未登録太郎"


@pytest.mark.asyncio
async def test_import_csv_matches_full_name_only(session: AsyncSession) -> None:
    """User.name ではなく User.full_name のみで照合されることをテスト。"""
    admin = User(
        id="user-admin",
        name="管理者",
        full_name="管理者 太郎",
        email="admin@example.com",
        role="admin",
        is_active=1,
    )
    # name="山田花子", full_name="ヤマダ ハナコ"
    user = User(
        id="user-yamada",
        name="山田花子",
        full_name="ヤマダ ハナコ",
        email="yamada@example.com",
        role="employee",
        is_active=1,
    )
    session.add_all([admin, user])
    await session.commit()

    # User.name である "山田花子" での検索 -> マッチしないはず
    csv_by_name = (
        "氏名,勤務開始日時,勤務終了日時,実働時間数\n"
        "山田花子,2026/04/07 13:00:00,2026/04/07 18:00:00,5:00:00\n"
    )
    service = AttendanceService(session)
    res1 = await service.import_csv_report(csv_by_name.encode("utf-8"), admin)
    assert res1.imported_count == 0
    assert res1.unmatched_names == ["山田花子"]

    # User.full_name である "ヤマダ　ハナコ" での検索 -> マッチする
    csv_by_full_name = (
        "氏名,勤務開始日時,勤務終了日時,実働時間数\n"
        "ヤマダ　ハナコ,2026/04/07 13:00:00,2026/04/07 18:00:00,5:00:00\n"
    )
    res2 = await service.import_csv_report(csv_by_full_name.encode("utf-8"), admin)
    assert res2.imported_count == 1
    assert res2.unmatched_names == []


@pytest.mark.asyncio
async def test_import_csv_with_existing_shift_keeps_actual_times(session: AsyncSession) -> None:
    """シフトが存在する場合でも、CSVの出退勤時刻がそのままwork_start/work_endに反映されることをテスト。"""
    from kint.models.shift import Shift

    admin = User(
        id="user-admin",
        name="管理者",
        full_name="管理者 太郎",
        email="admin@example.com",
        role="admin",
        is_active=1,
    )
    user = User(
        id="user-kuroda",
        name="kuroda",
        full_name="黒田 航宇",
        email="kuroda@example.com",
        role="employee",
        is_active=1,
    )
    # 13:00 〜 17:30 のシフト
    shift = Shift(
        id="shift-1",
        user_id="user-kuroda",
        shift_date=date(2026, 4, 1),
        start_time=datetime(2026, 4, 1, 13, 0, 0),
        end_time=datetime(2026, 4, 1, 17, 30, 0),
        google_event_id="evt-1",
    )
    session.add_all([admin, user, shift])
    await session.commit()

    # CSV: 13:00 〜 18:00
    csv_text = (
        "氏名,勤務開始日時,勤務終了日時,実働時間数\n"
        "黒田 航宇,2026/04/01 13:00:00,2026/04/01 18:00:00,5:00:00\n"
    )

    service = AttendanceService(session)
    res = await service.import_csv_report(csv_text.encode("utf-8"), admin)

    assert res.imported_count == 1

    att = (
        await session.execute(
            select(Attendance).where(
                Attendance.user_id == "user-kuroda",
                Attendance.work_date == date(2026, 4, 1),
            )
        )
    ).scalar_one_or_none()

    assert att is not None
    assert att.check_in == datetime(2026, 4, 1, 4, 0, 0)
    assert att.check_out == datetime(2026, 4, 1, 9, 0, 0)
    assert att.work_start == datetime(2026, 4, 1, 4, 0, 0)
    assert att.work_end == datetime(2026, 4, 1, 9, 0, 0)
    assert att.is_manual_work_time is True


@pytest.mark.asyncio
async def test_import_csv_with_multiple_existing_records(session: AsyncSession) -> None:
    """同日にすでに複数の勤怠レコードが存在する場合でも、CSVインポートがクラッシュせずに処理されることをテスト。"""
    # 管理者と従業員作成
    admin = User(
        id="user-admin",
        name="管理者",
        full_name="管理者 太郎",
        email="admin@example.com",
        role="admin",
        is_active=1,
    )
    user = User(
        id="user-1",
        name="sato_ren",
        full_name="佐藤 蓮",
        email="sato@example.com",
        role="employee",
        is_active=1,
    )
    # 同日に2件の勤怠データをあらかじめ作成
    att1 = Attendance(
        id="att-1",
        user_id="user-1",
        work_date=date(2026, 4, 1),
        check_in=datetime(2026, 4, 1, 4, 0, 0),  # 13:00 JST
        check_out=datetime(2026, 4, 1, 6, 0, 0), # 15:00 JST
        work_start=datetime(2026, 4, 1, 4, 0, 0),
        work_end=datetime(2026, 4, 1, 6, 0, 0),
        source="webusb_nfc",
        created_at=datetime(2026, 4, 1, 4, 0, 0),
        updated_at=datetime(2026, 4, 1, 4, 0, 0),
    )
    att2 = Attendance(
        id="att-2",
        user_id="user-1",
        work_date=date(2026, 4, 1),
        check_in=datetime(2026, 4, 1, 7, 0, 0),  # 16:00 JST
        check_out=datetime(2026, 4, 1, 9, 0, 0), # 18:00 JST
        work_start=datetime(2026, 4, 1, 7, 0, 0),
        work_end=datetime(2026, 4, 1, 9, 0, 0),
        source="webusb_nfc",
        created_at=datetime(2026, 4, 1, 7, 0, 0),
        updated_at=datetime(2026, 4, 1, 7, 0, 0),
    )
    session.add_all([admin, user, att1, att2])
    await session.commit()

    # CSV: 1行（同日に1回の勤務）
    csv_text = (
        "氏名,勤務開始日時,勤務終了日時\n"
        "佐藤 蓮,2026/04/01 13:30,2026/04/01 17:30\n"
    )

    service = AttendanceService(session)
    res = await service.import_csv_report(csv_text.encode("utf-8"), admin)

    assert res.imported_count == 1
    assert res.errors == []

    # DBレコードの検証
    # 元々あった2件のうち、1つ目が更新され、
    # 2件目は source != "admin_manual" のため勤務時間がクリアされるはず
    atts = (
        await session.execute(
            select(Attendance)
            .where(Attendance.user_id == "user-1", Attendance.work_date == date(2026, 4, 1))
            .order_by(Attendance.created_at.asc())
        )
    ).scalars().all()

    assert len(atts) == 2
    # 1件目は更新されたデータ (13:30 -> UTC 04:30, 17:30 -> UTC 08:30)
    assert atts[0].id == "att-1"
    assert atts[0].check_in.replace(tzinfo=None) == datetime(2026, 4, 1, 4, 30, 0)
    assert atts[0].check_out.replace(tzinfo=None) == datetime(2026, 4, 1, 8, 30, 0)
    assert atts[0].work_start.replace(tzinfo=None) == datetime(2026, 4, 1, 4, 30, 0)
    assert atts[0].work_end.replace(tzinfo=None) == datetime(2026, 4, 1, 8, 30, 0)

    # 2件目は勤務時間がクリアされる
    assert atts[1].id == "att-2"
    assert atts[1].work_start is None
    assert atts[1].work_end is None

