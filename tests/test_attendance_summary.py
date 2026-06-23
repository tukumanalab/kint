"""勤怠サマリー・月次詳細・エクスポート API のテスト。"""

import csv
import io
from datetime import date, datetime

from httpx import AsyncClient

from kint.models.attendance import Attendance
from kint.models.shift import Shift
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


async def _login(
    client: AsyncClient, account_id: str = "testuser", password: str = "Password123"
) -> str:
    """JWTトークンを直接生成して返す。"""
    from kint.routers.auth import _create_access_token

    return _create_access_token(account_id, 1)


async def _setup_test_data(session):
    """シフトと勤怠のテストデータを準備する。"""
    # ユーザーを作成
    admin = await _create_user(
        session,
        id="admin_user",
        name="管理者",
        full_name="Admin User",
        email="admin@example.com",
        role="admin",
    )
    emp = await _create_user(
        session,
        id="emp_user",
        name="一般社員",
        full_name="Employee User",
        email="emp@example.com",
        role="employee",
    )

    # 1. emp_user シフト1: 遅刻・早退なし (2026-05-01 09:00 - 18:00)
    # 実打刻: (2026-05-01 08:50 - 18:10) => 超過 10 分 (0.17h), 実働 9.33h
    shift1 = Shift(
        id="s1",
        user_id="emp_user",
        shift_date=date(2026, 5, 1),
        start_time=datetime(2026, 5, 1, 9, 0, 0),
        end_time=datetime(2026, 5, 1, 18, 0, 0),
        google_event_id="evt1",
    )
    att1 = Attendance(
        id="a1",
        user_id="emp_user",
        work_date=date(2026, 5, 1),
        check_in=datetime(2026, 5, 1, 8, 50, 0),
        check_out=datetime(2026, 5, 1, 18, 10, 0),
        source="webusb_nfc",
    )

    # 2. emp_user シフト2: 遅刻 (2026-05-02 09:00 - 18:00)
    # 実打刻: (2026-05-02 09:05 - 18:00) => 遅刻:是, 早退:否
    shift2 = Shift(
        id="s2",
        user_id="emp_user",
        shift_date=date(2026, 5, 2),
        start_time=datetime(2026, 5, 2, 9, 0, 0),
        end_time=datetime(2026, 5, 2, 18, 0, 0),
        google_event_id="evt2",
    )
    att2 = Attendance(
        id="a2",
        user_id="emp_user",
        work_date=date(2026, 5, 2),
        check_in=datetime(2026, 5, 2, 9, 5, 0),
        check_out=datetime(2026, 5, 2, 18, 0, 0),
        source="webusb_nfc",
    )

    # 3. emp_user シフト3: 欠勤 (2026-05-03 09:00 - 18:00)
    # 実打刻: なし => 欠勤
    shift3 = Shift(
        id="s3",
        user_id="emp_user",
        shift_date=date(2026, 5, 3),
        start_time=datetime(2026, 5, 3, 9, 0, 0),
        end_time=datetime(2026, 5, 3, 18, 0, 0),
        google_event_id="evt3",
    )

    # 4. emp_user シフト4: 打刻不整合 (2026-05-04 09:00 - 18:00)
    # 実打刻: (2026-05-04 08:55 - NULL) => 打刻不整合
    shift4 = Shift(
        id="s4",
        user_id="emp_user",
        shift_date=date(2026, 5, 4),
        start_time=datetime(2026, 5, 4, 9, 0, 0),
        end_time=datetime(2026, 5, 4, 18, 0, 0),
        google_event_id="evt4",
    )
    att4 = Attendance(
        id="a4",
        user_id="emp_user",
        work_date=date(2026, 5, 4),
        check_in=datetime(2026, 5, 4, 8, 55, 0),
        check_out=None,
        source="webusb_nfc",
    )

    session.add_all([shift1, att1, shift2, att2, shift3, shift4, att4])
    await session.commit()
    return admin, emp


class TestAttendanceSummaryAPI:
    async def test_get_monthly_summary_admin(self, client: AsyncClient, session) -> None:
        """管理者は全ユーザーのサマリーの一覧を取得できる。"""
        admin, emp = await _setup_test_data(session)
        token = await _login(client, account_id="admin_user", password="Password123")

        resp = await client.get(
            "/api/v1/attendance/summary?year_month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()

        # 管理者と従業員の2人が active なので、2件
        assert len(data) == 2

        emp_summary = next(x for x in data if x["user_id"] == "emp_user")
        assert emp_summary["prescribed_days"] == 4
        assert emp_summary["working_days"] == 3
        assert emp_summary["late_count"] == 1
        assert emp_summary["early_leave_count"] == 0
        assert emp_summary["absence_days"] == 1
        assert emp_summary["incomplete_days"] == 1
        assert emp_summary["yearly_working_hours"] == emp_summary["total_working_hours"]

    async def test_get_monthly_summary_employee_self(self, client: AsyncClient, session) -> None:
        """一般従業員は自分のサマリーのみ取得できる。"""
        admin, emp = await _setup_test_data(session)
        token = await _login(client, account_id="emp_user", password="Password123")

        resp = await client.get(
            "/api/v1/attendance/summary?year_month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # 従業員自身のみ
        assert len(data) == 1
        assert data[0]["user_id"] == "emp_user"

    async def test_get_monthly_summary_employee_forbidden(
        self, client: AsyncClient, session
    ) -> None:
        """一般従業員が他ユーザーのサマリーを指定した場合は、通常無視される、または自分に上書きされる。"""
        admin, emp = await _setup_test_data(session)
        token = await _login(client, account_id="emp_user", password="Password123")

        # user_id に admin_user を指定するが、employee なので自動的に emp_user のサマリーのみが返る
        resp = await client.get(
            "/api/v1/attendance/summary?year_month=2026-05&user_id=admin_user",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["user_id"] == "emp_user"


class TestAttendanceDetailAPI:
    async def test_get_monthly_detail_admin(self, client: AsyncClient, session) -> None:
        """管理者は任意のユーザーの月間詳細を取得できる。"""
        admin, emp = await _setup_test_data(session)
        token = await _login(client, account_id="admin_user", password="Password123")

        resp = await client.get(
            "/api/v1/attendance/monthly?year_month=2026-05&user_id=emp_user",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "emp_user"
        # 2026年5月は31日間ある
        assert len(data["days"]) == 31

        # 各日の検証
        day1 = next(d for d in data["days"] if d["work_date"] == "2026-05-01")
        assert day1["has_shift"] is True
        assert day1["status"] == "normal"
        assert day1["working_hours"] == 9.0  # 丸め後: 18:00 - 09:00 => 9.0h
        assert day1["overtime_hours"] == 0.0  # 丸め後: 18:00 - 18:00 => 0.0h
        assert "09:00:00" in day1["calculated_check_in"]
        assert "18:00:00" in day1["calculated_check_out"]

        day2 = next(d for d in data["days"] if d["work_date"] == "2026-05-02")
        assert day2["has_shift"] is True
        assert day2["status"] == "late"
        assert "09:05:00" in day2["calculated_check_in"]

        day3 = next(d for d in data["days"] if d["work_date"] == "2026-05-03")
        assert day3["has_shift"] is True
        assert day3["status"] == "absence"

        day4 = next(d for d in data["days"] if d["work_date"] == "2026-05-04")
        assert day4["has_shift"] is True
        assert day4["status"] == "incomplete"

    async def test_get_monthly_detail_employee_forbidden(
        self, client: AsyncClient, session
    ) -> None:
        """一般従業員が他ユーザーの月間詳細を取得しようとすると 403 になる。"""
        admin, emp = await _setup_test_data(session)
        token = await _login(client, account_id="emp_user", password="Password123")

        resp = await client.get(
            "/api/v1/attendance/monthly?year_month=2026-05&user_id=admin_user",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403


class TestAttendanceExportAPI:
    async def test_export_detailed_csv_admin(self, client: AsyncClient, session) -> None:
        """管理者は日次詳細のCSVをエクスポートできる。"""
        admin, emp = await _setup_test_data(session)
        token = await _login(client, account_id="admin_user", password="Password123")

        resp = await client.get(
            "/api/v1/attendance/export?year_month=2026-05&scope=detailed",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "text/csv; charset=utf-8"
        assert "Content-Disposition" in resp.headers

        # BOM の確認 (\xef\xbb\xbf)
        content_bytes = resp.content
        assert content_bytes.startswith(b"\xef\xbb\xbf")

        # CSV パース
        csv_str = content_bytes[3:].decode("utf-8")
        f = io.StringIO(csv_str)
        reader = csv.reader(f)
        rows = list(reader)
        # ヘッダー行 + 打刻がある日のみ出力 (emp_user: 5/1, 5/2, 5/4 の3行, admin: 0行)
        assert len(rows) == 4
        assert rows[0] == [
            "日付",
            "表示名",
            "氏名",
            "シフト開始時刻",
            "シフト終了時刻",
            "出勤打刻",
            "退勤打刻",
            "出勤",
            "退勤",
            "勤務時間",
            "勤怠ステータス",
            "打刻ソース",
            "修正理由",
        ]

    async def test_export_summary_csv_admin(self, client: AsyncClient, session) -> None:
        """管理者は月次サマリーのCSVをエクスポートできる。"""
        admin, emp = await _setup_test_data(session)
        token = await _login(client, account_id="admin_user", password="Password123")

        resp = await client.get(
            "/api/v1/attendance/export?year_month=2026-05&scope=summary",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        content_bytes = resp.content
        assert content_bytes.startswith(b"\xef\xbb\xbf")

        csv_str = content_bytes[3:].decode("utf-8")
        f = io.StringIO(csv_str)
        reader = csv.reader(f)
        rows = list(reader)
        # ヘッダー + 2人分 = 3行
        assert len(rows) == 3
        assert rows[0][0] == "対象月"

    async def test_export_csv_employee_forbidden(self, client: AsyncClient, session) -> None:
        """一般従業員はCSVエクスポートを呼び出せない(403)。"""
        admin, emp = await _setup_test_data(session)
        token = await _login(client, account_id="emp_user", password="Password123")

        resp = await client.get(
            "/api/v1/attendance/export?year_month=2026-05",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403


class TestMultiplePunchesInSameDay:
    async def test_multiple_punches_aggregation(self, client: AsyncClient, session) -> None:
        """1日に複数回の出退勤（打刻）がある場合の実労働時間・遅刻/早退判定・出退勤時刻の取得を検証する。"""
        # テスト用の従業員とシフト
        await _create_user(
            session,
            id="multipunch_user",
            name="複数打刻者",
            full_name="Multi Punch User",
            email="multi@example.com",
            role="employee",
        )

        shift = Shift(
            id="ms1",
            user_id="multipunch_user",
            shift_date=date(2026, 5, 10),
            start_time=datetime(2026, 5, 10, 9, 0, 0),
            end_time=datetime(2026, 5, 10, 18, 0, 0),
            google_event_id="mevt1",
        )

        # 1回目の打刻: 08:45 〜 12:15 (3.5時間)
        att_a = Attendance(
            id="ma1",
            user_id="multipunch_user",
            work_date=date(2026, 5, 10),
            check_in=datetime(2026, 5, 10, 8, 45, 0),
            check_out=datetime(2026, 5, 10, 12, 15, 0),
            source="webusb_nfc",
        )

        # 2回目の打刻: 13:00 〜 18:00 (5.0時間)
        att_b = Attendance(
            id="ma2",
            user_id="multipunch_user",
            work_date=date(2026, 5, 10),
            check_in=datetime(2026, 5, 10, 13, 0, 0),
            check_out=datetime(2026, 5, 10, 18, 0, 0),
            source="web_user_id",
            updated_reason="外出・再入館",
        )

        session.add_all([shift, att_a, att_b])
        await session.commit()

        token = await _login(client, account_id="multipunch_user", password="Password123")

        # 1. 月間詳細を取得して2026-05-10の値を検証
        resp = await client.get(
            "/api/v1/attendance/monthly?year_month=2026-05&user_id=multipunch_user",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()

        day_data = next(d for d in data["days"] if d["work_date"] == "2026-05-10")
        assert day_data["has_shift"] is True
        assert day_data["status"] == "normal"
        # 丸め後: 3.25h + 5.0h = 8.25h
        assert day_data["working_hours"] == 8.25
        # 最初出退勤が正しく取得できているか
        assert "08:45:00" in day_data["check_in"]
        assert "18:00:00" in day_data["check_out"]
        assert "09:00:00" in day_data["calculated_check_in"]
        assert "18:00:00" in day_data["calculated_check_out"]

        # 2. サマリーの合計時間が合算されているか検証
        summary = data["summary"]
        assert summary["total_working_hours"] == 8.25
        assert summary["working_days"] == 1
        assert summary["late_count"] == 0
        assert summary["early_leave_count"] == 0

        # punches リストの検証
        assert "punches" in day_data
        assert len(day_data["punches"]) == 2
        p1 = day_data["punches"][0]
        p2 = day_data["punches"][1]
        assert "08:45:00" in p1["check_in"]
        assert "12:15:00" in p1["check_out"]
        assert "09:00:00" in p1["calculated_check_in"]
        assert "12:15:00" in p1["calculated_check_out"]
        assert "13:00:00" in p2["check_in"]
        assert "18:00:00" in p2["check_out"]
        assert "13:00:00" in p2["calculated_check_in"]
        assert "18:00:00" in p2["calculated_check_out"]

        # 管理者のトークンを使って CSV で複数打刻が出力されているか検証する
        await _create_user(
            session,
            id="admin_for_csv",
            name="管理者CSV",
            full_name="CSV Admin",
            email="admin_csv@example.com",
            role="admin",
        )
        admin_token = await _login(client, account_id="admin_for_csv", password="Password123")
        resp_csv = await client.get(
            "/api/v1/attendance/export?year_month=2026-05&scope=detailed",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp_csv.status_code == 200, resp_csv.text
        content_bytes = resp_csv.content
        csv_str = content_bytes[3:].decode("utf-8")
        f = io.StringIO(csv_str)
        reader = csv.reader(f)
        rows = list(reader)

        # 複数打刻者 (multipunch_user) の 2026-05-10 のすべての行を探す
        target_rows = []
        for row in rows:
            if row[0] == "2026-05-10" and row[1] == "複数打刻者":
                target_rows.append(row)

        assert len(target_rows) == 2

        # 1行目: 1回目の打刻（08:45 〜 12:15 UTC）が JST 換算されて出力されている
        row1 = target_rows[0]
        assert "17:45:00" in row1[5]  # 出勤打刻 JST
        assert "21:15:00" in row1[6]  # 退勤打刻 JST
        assert "18:00:00" in row1[7]  # 出勤 JST (丸め後)
        assert "21:15:00" in row1[8]  # 退勤 JST (丸め後)
        assert row1[9] == "3:15"  # 勤務時間 (丸め後 3.25時間)

        # 2行目: 2回目の打刻（13:00 〜 18:00 UTC）が JST 換算されて出力されている
        row2 = target_rows[1]
        assert "22:00:00" in row2[5]  # 出勤打刻 JST
        assert "03:00:00" in row2[6]  # 退勤打刻 JST
        assert "22:00:00" in row2[7]  # 出勤 JST (丸め後)
        assert "03:00:00" in row2[8]  # 退勤 JST (丸め後)
        assert row2[9] == "5:00"  # 勤務時間 (5.0時間)

    async def test_get_monthly_detail_future_shift(self, client: AsyncClient, session) -> None:
        """未来のシフト予定日で打刻がない場合、ステータスが "scheduled" になることを検証する。"""
        from datetime import datetime, timedelta, timezone

        JST = timezone(timedelta(hours=9))
        today = datetime.now(JST).date()
        future_date = today + timedelta(days=5)  # 5日後の未来

        # ユーザーを作成
        emp = await _create_user(
            session,
            id="future_user",
            name="未来ユーザー",
            full_name="Future User",
            email="future@example.com",
            role="employee",
        )

        # 未来のシフトを登録 (9:00 - 18:00)
        shift = Shift(
            id="s_future",
            user_id="future_user",
            shift_date=future_date,
            start_time=datetime(future_date.year, future_date.month, future_date.day, 9, 0, 0),
            end_time=datetime(future_date.year, future_date.month, future_date.day, 18, 0, 0),
            google_event_id="evt_future",
        )
        session.add(shift)
        await session.commit()

        token = await _login(client, account_id="future_user", password="Password123")

        # 月次詳細を取得して未来日の値を検証
        year_month = future_date.strftime("%Y-%m")
        resp = await client.get(
            f"/api/v1/attendance/monthly?year_month={year_month}&user_id=future_user",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()

        day_data = next(d for d in data["days"] if d["work_date"] == future_date.isoformat())
        assert day_data["has_shift"] is True
        assert day_data["status"] == "scheduled"
