"""打刻・勤怠サービス。BE-01〜BE-04 のビジネスロジックを実装する。"""

import calendar
import csv
import io
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.exceptions import KintConflictError, KintNotFoundError
from kint.models.attendance import Attendance, AttendanceChangeLog
from kint.models.card import Card
from kint.models.shift import Shift
from kint.models.user import User
from kint.schemas.attendance import (
    AttendanceHistoryEntry,
    AttendanceHistoryResponse,
    AttendanceHistorySnapshot,
    AttendanceListResponse,
    AttendanceMonthlyDetailResponse,
    AttendanceMonthlySummary,
    AttendancePatchRequest,
    AttendanceRecord,
    DailyAttendanceDetail,
    PunchPeriod,
)
from kint.schemas.punch import PunchRequest, PunchResponse
from kint.services.settings import SettingsService


class PunchService:
    """打刻サービス。card_idm / user_id の両経路を処理する。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ------------------------------------------------------------------
    # BE-02: 利用者解決メソッド
    # ------------------------------------------------------------------

    async def _get_user_by_card_idm(self, card_idm: str) -> User:
        """card_idm からアクティブなカード経由でユーザーを返す。未登録なら KintNotFoundError。"""
        result = await self.session.execute(
            select(Card).where(Card.card_idm == card_idm, Card.is_active == 1)
        )
        card = result.scalar_one_or_none()
        if card is None:
            raise KintNotFoundError(
                code="CARD_NOT_FOUND",
                message=f"カード IDm '{card_idm}' は登録されていません",
                detail={"card_idm": card_idm},
            )
        result_user = await self.session.execute(
            select(User).where(User.id == card.user_id, User.is_active == 1)
        )
        user = result_user.scalar_one_or_none()
        if user is None:
            raise KintNotFoundError(
                code="USER_NOT_FOUND",
                message="カードに紐付くユーザーが見つかりません",
                detail={"card_idm": card_idm},
            )
        return user

    async def _get_user_by_user_id(self, user_id: str) -> User:
        """user_id からユーザーを返す。未登録なら KintNotFoundError。"""
        result = await self.session.execute(
            select(User).where(User.id == user_id, User.is_active == 1)
        )
        user = result.scalar_one_or_none()
        if user is None:
            raise KintNotFoundError(
                code="USER_NOT_FOUND",
                message=f"ユーザー ID '{user_id}' は登録されていません",
                detail={"user_id": user_id},
            )
        return user

    async def _get_attendance_for_date(self, user_id: str, work_date: date) -> Attendance | None:
        """指定日の最新勤怠レコードを返す。存在しない場合は None。"""
        result = await self.session.execute(
            select(Attendance)
            .where(
                Attendance.user_id == user_id,
                Attendance.work_date == work_date,
            )
            .order_by(Attendance.check_in.desc(), Attendance.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _get_open_attendance(self, user_id: str) -> Attendance | None:
        """未退勤の最新勤怠レコードを返す。存在しない場合は None。"""
        result = await self.session.execute(
            select(Attendance)
            .where(Attendance.user_id == user_id, Attendance.check_out.is_(None))
            .order_by(Attendance.check_in.desc(), Attendance.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _get_latest_attendance(self, user_id: str) -> Attendance | None:
        """ユーザーの最新打刻を持つ勤怠レコードを返す。"""
        result = await self.session.execute(
            select(Attendance)
            .where(Attendance.user_id == user_id)
            .order_by(
                func.coalesce(Attendance.check_out, Attendance.check_in).desc(),
                Attendance.created_at.desc(),
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _as_utc(dt: datetime) -> datetime:
        """日時を UTC 基準に正規化して返す。"""
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)

    async def _validate_cooldown(self, user_id: str, occurred_at: datetime) -> None:
        """直近打刻からクールダウン秒数以内の連続打刻を拒否する。"""
        latest = await self._get_latest_attendance(user_id)
        if latest is None:
            return

        latest_punched_at = latest.check_out or latest.check_in
        if latest_punched_at is None:
            return

        diff_seconds = (self._as_utc(occurred_at) - self._as_utc(latest_punched_at)).total_seconds()
        svc = SettingsService(self.session)
        cooldown_seconds = await svc.get_int("punch_cooldown_seconds")
        if diff_seconds >= cooldown_seconds:
            return

        remaining_seconds = max(1, int(cooldown_seconds - diff_seconds))
        raise KintConflictError(
            code="PUNCH_COOLDOWN_ACTIVE",
            message=(
                "直前に打刻したばかりです。"
                f"あと {remaining_seconds} 秒ほど待ってから再度打刻してください。"
            ),
            detail={
                "user_id": user_id,
                "cooldown_seconds": cooldown_seconds,
                "remaining_seconds": remaining_seconds,
            },
        )

    async def _has_shift_for_check_in(self, user_id: str, occurred_at: datetime) -> bool:
        """時刻がシフト範囲（開始前許容を含む）に入るかを判定する。"""
        occurred_date = occurred_at.date()
        result = await self.session.execute(
            select(Shift)
            .where(
                Shift.user_id == user_id,
                Shift.shift_date >= occurred_date - timedelta(days=1),
                Shift.shift_date <= occurred_date + timedelta(days=1),
            )
            .order_by(Shift.start_time.asc())
        )
        shifts = result.scalars().all()

        svc = SettingsService(self.session)
        early_window = timedelta(minutes=await svc.get_int("shift_checkin_early_minutes"))
        occurred_utc = self._as_utc(occurred_at)
        for shift in shifts:
            start = self._as_utc(shift.start_time) - early_window
            end = self._as_utc(shift.end_time)
            if start <= occurred_utc <= end:
                return True
        return False

    # ------------------------------------------------------------------
    # BE-01 / BE-02 / BE-03 / BE-04: 打刻コア処理
    # ------------------------------------------------------------------

    async def punch(self, request: PunchRequest) -> PunchResponse:
        """打刻を処理する。check_in / check_out を自動判定する。"""
        # BE-02: 利用者解決
        if request.card_idm is not None:
            user = await self._get_user_by_card_idm(request.card_idm)
            source = "webusb_nfc"
            method = "card_idm"
        else:
            # user_id は model_validator で None でないことが保証される
            user = await self._get_user_by_user_id(request.user_id)  # type: ignore[arg-type]
            source = "web_user_id"
            method = "user_id"

        await self._validate_cooldown(user.id, request.occurred_at)
        attendance = await self._get_open_attendance(user.id)

        if attendance is not None:
            await self._do_check_out(
                attendance=attendance,
                occurred_at=request.occurred_at,
                method=method,
                reason=request.reason,
                actor_user=user,
            )
            action = "check_out"
        else:
            has_shift = await self._has_shift_for_check_in(user.id, request.occurred_at)
            if not has_shift and not request.confirm:
                settings_svc = SettingsService(self.session)
                ical_url = await settings_svc.get_str("shift_ical_url")
                sync_hint = "シフト同期設定あり" if ical_url else "SHIFT_ICAL_URL 未設定"
                return PunchResponse(
                    status="requires_confirmation",
                    attendance_id=None,
                    user_id=user.id,
                    user_name=user.name,
                    action=None,
                    occurred_at=request.occurred_at,
                    method=method,  # type: ignore[arg-type]
                    message=(
                        "現在シフトが入っていません。"
                        f"（{sync_hint}）"
                        "出勤として打刻する場合は確認してください。"
                    ),
                )

            work_date = request.occurred_at.date()
            attendance = await self._do_check_in(
                user=user,
                work_date=work_date,
                occurred_at=request.occurred_at,
                card_idm=request.card_idm,
                source=source,
                method=method,
                reason=request.reason,
            )
            action = "check_in"

        await self.session.commit()

        action_label = "出勤" if action == "check_in" else "退勤"
        return PunchResponse(
            status="completed",
            attendance_id=attendance.id,
            user_id=user.id,
            user_name=user.name,
            action=action,  # type: ignore[arg-type]
            occurred_at=request.occurred_at,
            method=method,  # type: ignore[arg-type]
            message=f"{action_label}を記録しました",
        )

    async def _do_check_in(
        self,
        *,
        user: User,
        work_date: date,
        occurred_at: datetime,
        card_idm: str | None,
        source: str,
        method: str,
        reason: str | None,
    ) -> Attendance:
        """チェックイン処理。新規 Attendance レコードを作成する。"""
        now = datetime.now(tz=UTC)
        attendance = Attendance(
            id=str(uuid.uuid4()),
            user_id=user.id,
            card_idm=card_idm,
            work_date=work_date,
            check_in=occurred_at,
            check_out=None,
            source=source,
            # BE-04: user_id 打刻時は updated_reason / last_updated_* を記録する
            updated_reason=reason if method == "user_id" else None,
            last_updated_by_user_id=user.id if method == "user_id" else None,
            last_updated_at=now if method == "user_id" else None,
        )
        self.session.add(attendance)
        await self.session.flush()

        # BE-04: user_id 打刻時は監査ログを追記する
        if method == "user_id" and reason is not None:
            log = AttendanceChangeLog(
                id=str(uuid.uuid4()),
                attendance_id=attendance.id,
                actor_user_id=user.id,
                actor_role=user.role,
                before_check_in=None,
                before_check_out=None,
                after_check_in=occurred_at,
                after_check_out=None,
                reason=reason,
                changed_at=now,
            )
            self.session.add(log)

        return attendance

    async def _do_check_out(
        self,
        *,
        attendance: Attendance,
        occurred_at: datetime,
        method: str,
        reason: str | None,
        actor_user: User,
    ) -> None:
        """チェックアウト処理。既存 Attendance レコードを更新する。"""
        now = datetime.now(tz=UTC)
        before_check_in = attendance.check_in

        attendance.check_out = occurred_at
        # BE-04: user_id 打刻時は updated_reason / last_updated_* を更新する
        if method == "user_id" and reason is not None:
            attendance.updated_reason = reason
            attendance.last_updated_by_user_id = actor_user.id
            attendance.last_updated_at = now

        await self.session.flush()

        # BE-04: user_id 打刻時は監査ログを追記する（同一トランザクション）
        if method == "user_id" and reason is not None:
            log = AttendanceChangeLog(
                id=str(uuid.uuid4()),
                attendance_id=attendance.id,
                actor_user_id=actor_user.id,
                actor_role=actor_user.role,
                before_check_in=before_check_in,
                before_check_out=None,
                after_check_in=before_check_in,
                after_check_out=occurred_at,
                reason=reason,
                changed_at=now,
            )
            self.session.add(log)


class AttendanceService:
    """勤怠管理サービス。一覧取得・修正・履歴取得を処理する。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_attendances(
        self,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
        user_id: str | None = None,
        page: int = 1,
        page_size: int = 50,
    ) -> AttendanceListResponse:
        """条件で絞り込んだ勤怠一覧を返す。"""
        query = select(Attendance)
        if from_date is not None:
            query = query.where(Attendance.work_date >= from_date)
        if to_date is not None:
            query = query.where(Attendance.work_date <= to_date)
        if user_id is not None:
            query = query.where(Attendance.user_id == user_id)

        count_result = await self.session.execute(
            select(func.count()).select_from(query.subquery())
        )
        total = count_result.scalar_one()

        query = (
            query.order_by(Attendance.work_date.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.session.execute(query)
        rows = result.scalars().all()

        return AttendanceListResponse(
            items=[AttendanceRecord.model_validate(r) for r in rows],
            page=page,
            page_size=page_size,
            total=total,
        )

    async def patch_attendance(
        self,
        attendance_id: str,
        patch: AttendancePatchRequest,
        actor: User,
    ) -> AttendanceRecord:
        """勤怠記録を修正し、変更履歴を同一トランザクションで保存する。"""
        result = await self.session.execute(
            select(Attendance).where(Attendance.id == attendance_id)
        )
        attendance = result.scalar_one_or_none()
        if attendance is None:
            raise KintNotFoundError(
                code="ATTENDANCE_NOT_FOUND",
                message=f"勤怠記録 '{attendance_id}' が見つかりません",
            )

        now = datetime.now(tz=UTC)
        before_check_in = attendance.check_in
        before_check_out = attendance.check_out

        if patch.check_in is not None:
            attendance.check_in = patch.check_in
        if patch.check_out is not None:
            attendance.check_out = patch.check_out

        attendance.updated_reason = patch.reason
        attendance.last_updated_by_user_id = actor.id
        attendance.last_updated_at = now

        await self.session.flush()

        # BE-04: 修正時も監査ログを同一トランザクションで保存する
        log = AttendanceChangeLog(
            id=str(uuid.uuid4()),
            attendance_id=attendance.id,
            actor_user_id=actor.id,
            actor_role=actor.role,
            before_check_in=before_check_in,
            before_check_out=before_check_out,
            after_check_in=attendance.check_in,
            after_check_out=attendance.check_out,
            reason=patch.reason,
            changed_at=now,
        )
        self.session.add(log)
        await self.session.commit()

        return AttendanceRecord.model_validate(attendance)

    async def get_history(self, attendance_id: str) -> AttendanceHistoryResponse:
        """指定勤怠の変更履歴一覧を返す。"""
        # 勤怠レコードの存在確認
        exists_result = await self.session.execute(
            select(Attendance.id).where(Attendance.id == attendance_id)
        )
        if exists_result.scalar_one_or_none() is None:
            raise KintNotFoundError(
                code="ATTENDANCE_NOT_FOUND",
                message=f"勤怠記録 '{attendance_id}' が見つかりません",
            )

        result = await self.session.execute(
            select(AttendanceChangeLog)
            .where(AttendanceChangeLog.attendance_id == attendance_id)
            .order_by(AttendanceChangeLog.changed_at.asc())
        )
        logs = result.scalars().all()

        items = [
            AttendanceHistoryEntry(
                id=log.id,
                attendance_id=log.attendance_id,
                actor_user_id=log.actor_user_id,
                actor_role=log.actor_role,  # type: ignore[arg-type]
                changed_at=log.changed_at,
                before=AttendanceHistorySnapshot(
                    check_in=log.before_check_in,
                    check_out=log.before_check_out,
                ),
                after=AttendanceHistorySnapshot(
                    check_in=log.after_check_in,
                    check_out=log.after_check_out,
                ),
                reason=log.reason,
            )
            for log in logs
        ]
        return AttendanceHistoryResponse(items=items, total=len(items))

    async def _calculate_monthly_data(
        self, year_month: str, user_id: str | None = None
    ) -> tuple[
        list[tuple[User, AttendanceMonthlySummary, list[DailyAttendanceDetail]]],
        dict[tuple[str, date], list[Attendance]],
    ]:
        """指定した年月の、対象ユーザー（または全員）のサマリーと日次明細を計算する。"""
        try:
            year, month = map(int, year_month.split("-"))
            _, last_day = calendar.monthrange(year, month)
        except ValueError:
            raise ValueError("年月は YYYY-MM 形式で指定してください。")

        from_date = date(year, month, 1)
        to_date = date(year, month, last_day)

        # 1. ユーザーの取得 (アクティブなユーザーのみ)
        user_query = select(User).where(User.is_active == 1)
        if user_id is not None:
            user_query = user_query.where(User.id == user_id)
        user_result = await self.session.execute(user_query)
        users = user_result.scalars().all()

        # 2. 勤怠レコードの一括取得
        att_query = select(Attendance).where(
            Attendance.work_date >= from_date,
            Attendance.work_date <= to_date,
        )
        if user_id is not None:
            att_query = att_query.where(Attendance.user_id == user_id)
        att_result = await self.session.execute(att_query)
        attendances = att_result.scalars().all()

        # 3. シフトの一括取得
        shift_query = select(Shift).where(
            Shift.shift_date >= from_date,
            Shift.shift_date <= to_date,
        )
        if user_id is not None:
            shift_query = shift_query.where(Shift.user_id == user_id)
        shift_result = await self.session.execute(shift_query)
        shifts = shift_result.scalars().all()

        # 4. ユーザーごとにマージ（1日に複数回打刻をサポートするためにリストで保持）
        att_map: dict[tuple[str, date], list[Attendance]] = {}
        for att in attendances:
            key = (att.user_id, att.work_date)
            if key not in att_map:
                att_map[key] = []
            att_map[key].append(att)

        shift_map = {}
        for shift in shifts:
            shift_map[(shift.user_id, shift.shift_date)] = shift

        results = []
        for user in users:
            daily_details = []
            prescribed_days = 0
            working_days = 0
            total_working_hours = 0.0
            total_overtime_hours = 0.0
            late_count = 0
            early_leave_count = 0
            absence_days = 0
            incomplete_days = 0

            # 1日から月末日まで走査
            for d in range(1, last_day + 1):
                cur_date = date(year, month, d)
                day_atts = att_map.get((user.id, cur_date), [])
                shift = shift_map.get((user.id, cur_date))

                has_shift = shift is not None
                is_holiday = not has_shift and len(day_atts) == 0

                shift_start = shift.start_time if shift else None
                shift_end = shift.end_time if shift else None

                # 全打刻中の最初出勤と最終退勤を抽出
                check_ins = [a.check_in for a in day_atts if a.check_in is not None]
                check_outs = [a.check_out for a in day_atts if a.check_out is not None]

                check_in = min(check_ins) if check_ins else None
                check_out = max(check_outs) if check_outs else None

                working_hours = 0.0
                overtime_hours = 0.0

                # 実労働時間の計算（全ての打刻セグメントの勤務時間を合算）
                for a in day_atts:
                    if a.check_in and a.check_out:
                        working_hours += (a.check_out - a.check_in).total_seconds() / 3600.0

                # 時間外労働時間の算出
                if has_shift and shift_end and check_out:
                    if check_out > shift_end:
                        overtime_hours = (check_out - shift_end).total_seconds() / 3600.0
                elif not has_shift and check_in and check_out:
                    if working_hours > 8.0:
                        overtime_hours = working_hours - 8.0

                # 遅刻／早退の判定（1分以上の差）
                is_late = False
                is_early = False

                if has_shift and shift_start and check_in:
                    if (check_in - shift_start).total_seconds() >= 60:
                        is_late = True

                if has_shift and shift_end and check_out:
                    if (shift_end - check_out).total_seconds() >= 60:
                        is_early = True

                # ステータスの決定（未退勤の打刻が1つでもあれば不整合）
                has_incomplete_punch = any(
                    a.check_in is not None and a.check_out is None for a in day_atts
                )

                if len(day_atts) > 0 and has_incomplete_punch:
                    status = "incomplete"
                elif has_shift and len(day_atts) == 0:
                    status = "absence"
                elif has_shift and is_late and is_early:
                    status = "late_and_early"
                elif has_shift and is_late:
                    status = "late"
                elif has_shift and is_early:
                    status = "early_leave"
                elif len(day_atts) > 0:
                    status = "normal"
                else:
                    status = "off_duty"

                # サマリー集計用の加算
                if has_shift:
                    prescribed_days += 1
                if len(day_atts) > 0:
                    working_days += 1
                total_working_hours += working_hours
                total_overtime_hours += overtime_hours

                if status == "incomplete":
                    incomplete_days += 1
                elif status == "absence":
                    absence_days += 1
                elif status == "late_and_early":
                    late_count += 1
                    early_leave_count += 1
                elif status == "late":
                    late_count += 1
                elif status == "early_leave":
                    early_leave_count += 1

                # ユニークな打刻ソースの結合
                sources = sorted(list(set(a.source for a in day_atts if a.source)))
                source = ", ".join(sources) if sources else None

                is_valid_work = len(day_atts) > 0 and not has_incomplete_punch

                def ensure_utc(dt: datetime | None) -> datetime | None:
                    if dt is None:
                        return None
                    if dt.tzinfo is None:
                        return dt.replace(tzinfo=UTC)
                    return dt.astimezone(UTC)

                # 1日の中のすべての打刻ペアを時系列順（check_in昇順）に整理して格納
                sorted_atts = sorted(
                    day_atts,
                    key=lambda a: a.check_in if a.check_in else datetime.max.replace(tzinfo=UTC)
                )
                punches = [
                    PunchPeriod(
                        check_in=ensure_utc(a.check_in),
                        check_out=ensure_utc(a.check_out),
                    )
                    for a in sorted_atts
                ]

                detail = DailyAttendanceDetail(
                    work_date=cur_date,
                    has_shift=has_shift,
                    is_holiday=is_holiday,
                    shift_start=ensure_utc(shift_start),
                    shift_end=ensure_utc(shift_end),
                    check_in=ensure_utc(check_in),
                    check_out=ensure_utc(check_out),
                    working_hours=round(working_hours, 2) if is_valid_work else None,
                    overtime_hours=round(overtime_hours, 2) if overtime_hours > 0 else 0.0,
                    status=status,
                    source=source,
                    punches=punches,
                )
                daily_details.append(detail)

            # サマリーを作成
            summary = AttendanceMonthlySummary(
                user_id=user.id,
                user_name=user.name,
                full_name=user.full_name,
                prescribed_days=prescribed_days,
                working_days=working_days,
                total_working_hours=round(total_working_hours, 2),
                total_overtime_hours=round(total_overtime_hours, 2),
                late_count=late_count,
                early_leave_count=early_leave_count,
                absence_days=absence_days,
                incomplete_days=incomplete_days,
            )

            results.append((user, summary, daily_details))

        return results, att_map

    async def get_monthly_summaries(
        self, year_month: str, user_id: str | None = None
    ) -> list[AttendanceMonthlySummary]:
        """指定した年月の、対象ユーザー（または全員）の月次サマリー一覧を返す。"""
        data, _ = await self._calculate_monthly_data(year_month, user_id=user_id)
        return [summary for _, summary, _ in data]

    async def get_monthly_detail(
        self, year_month: str, user_id: str
    ) -> AttendanceMonthlyDetailResponse:
        """指定した年月の、特定ユーザーの日別詳細とサマリーを返す。"""
        data, _ = await self._calculate_monthly_data(year_month, user_id=user_id)
        if not data:
            raise KintNotFoundError(
                code="USER_NOT_FOUND",
                message=f"ユーザーID '{user_id}' が見つかりません、またはアクティブではありません",
            )
        _, summary, daily_details = data[0]
        return AttendanceMonthlyDetailResponse(
            user_id=user_id,
            year_month=year_month,
            summary=summary,
            days=daily_details,
        )

    async def export_csv(self, year_month: str, scope: str = "detailed") -> bytes:
        """指定した年月の勤怠データをCSVフォーマットでエクスポートする。文字コードはBOM付きUTF-8(utf-8-sig)。"""
        data, att_map = await self._calculate_monthly_data(year_month)

        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")

        if scope == "summary":
            writer.writerow([
                "対象月",
                "ユーザーID",
                "表示名",
                "氏名",
                "所定労働日数",
                "実出勤日数",
                "総労働時間(h)",
                "時間外労働時間(h)",
                "遅刻回数",
                "早退回数",
                "欠勤日数",
                "打刻エラー日数",
            ])
            for _, summary, _ in data:
                writer.writerow([
                    year_month,
                    summary.user_id,
                    summary.user_name,
                    summary.full_name,
                    summary.prescribed_days,
                    summary.working_days,
                    f"{summary.total_working_hours:.2f}",
                    f"{summary.total_overtime_hours:.2f}",
                    summary.late_count,
                    summary.early_leave_count,
                    summary.absence_days,
                    summary.incomplete_days,
                ])
        else:
            writer.writerow([
                "日付",
                "表示名",
                "氏名",
                "シフト開始時刻",
                "シフト終了時刻",
                "出勤時間",
                "退勤時間",
                "実労働時間(h)",
                "時間外労働時間(h)",
                "遅刻判定",
                "早退判定",
                "勤怠ステータス",
                "打刻ソース",
                "修正理由",
            ])

            def ensure_utc(dt: datetime | None) -> datetime | None:
                if dt is None:
                    return None
                if dt.tzinfo is None:
                    return dt.replace(tzinfo=UTC)
                return dt.astimezone(UTC)

            def fmt_dt(dt: datetime | None) -> str:
                if dt is None:
                    return ""
                dt_utc = ensure_utc(dt)
                if dt_utc is None:
                    return ""
                jst_dt = dt_utc + timedelta(hours=9)
                return jst_dt.strftime("%Y-%m-%d %H:%M:%S")

            for user, _, daily_details in data:
                for day in daily_details:
                    shift_start_str = fmt_dt(day.shift_start)
                    shift_end_str = fmt_dt(day.shift_end)

                    status_labels = {
                        "normal": "正常",
                        "late": "遅刻",
                        "early_leave": "早退",
                        "late_and_early": "遅刻・早退",
                        "absence": "欠勤",
                        "incomplete": "打刻漏れ",
                        "off_duty": "休日",
                    }
                    status_label = status_labels.get(day.status, day.status)

                    day_atts = att_map.get((user.id, day.work_date), [])
                    max_dt = datetime.max.replace(tzinfo=UTC)
                    sorted_atts = sorted(
                        day_atts,
                        key=lambda a: ensure_utc(a.check_in) or max_dt
                    )

                    if sorted_atts:
                        # 打刻がある場合：各打刻レコード(エントリー)毎に1行ずつ出力する
                        for idx, att in enumerate(sorted_atts):
                            check_in_str = fmt_dt(att.check_in)
                            check_out_str = fmt_dt(att.check_out)

                            # 実労働時間（このエントリー単体）
                            working_hours = 0.0
                            if att.check_in and att.check_out:
                                cin_utc = ensure_utc(att.check_in) or datetime.min.replace(tzinfo=UTC)
                                cout_utc = ensure_utc(att.check_out) or datetime.min.replace(tzinfo=UTC)
                                duration = (cout_utc - cin_utc).total_seconds()
                                working_hours = duration / 3600.0

                            # 時間外労働時間（このエントリー単体）
                            overtime_hours = 0.0
                            att_check_out_utc = ensure_utc(att.check_out)
                            day_shift_end_utc = ensure_utc(day.shift_end)
                            att_check_in_utc = ensure_utc(att.check_in)

                            if day.has_shift and day_shift_end_utc and att_check_out_utc:
                                # シフト終了時刻を越えて退勤した場合
                                # このエントリーの退勤時刻がシフト終了より遅い場合
                                if att_check_out_utc > day_shift_end_utc:
                                    diff = att_check_out_utc - day_shift_end_utc
                                    over_sec = diff.total_seconds()
                                    overtime_hours = over_sec / 3600.0
                            elif not day.has_shift and att_check_in_utc and att_check_out_utc:
                                # シフトがない日の打刻で、そのエントリーが8時間を超えている場合
                                if working_hours > 8.0:
                                    overtime_hours = working_hours - 8.0

                            # 遅刻判定：その日の最古の打刻エントリーで評価
                            is_late_val = "否"
                            if day.has_shift:
                                first_att = sorted_atts[0]
                                first_check_in_utc = ensure_utc(first_att.check_in)
                                day_shift_start_utc = ensure_utc(day.shift_start)
                                if first_check_in_utc and day_shift_start_utc:
                                    diff = first_check_in_utc - day_shift_start_utc
                                    if diff.total_seconds() >= 60:
                                        is_late_val = "是"
                            else:
                                is_late_val = "-"

                            # 早退判定：その日の最新の打刻エントリーで評価
                            is_early_val = "否"
                            if day.has_shift:
                                last_att = sorted_atts[-1]
                                last_check_out_utc = ensure_utc(last_att.check_out)
                                day_shift_end_utc = ensure_utc(day.shift_end)
                                if last_check_out_utc and day_shift_end_utc:
                                    diff = day_shift_end_utc - last_check_out_utc
                                    if diff.total_seconds() >= 60:
                                        # ステータスが "early_leave" なら "是"
                                        is_early_val = "是"
                            else:
                                is_early_val = "-"

                            # エントリーに特化したステータス
                            # もし att 自体が unfinished (check_out が NULL) なら "打刻漏れ"
                            entry_status_label = status_label
                            if att.check_in and not att.check_out:
                                entry_status_label = "打刻漏れ"

                            writer.writerow([
                                day.work_date.strftime("%Y-%m-%d"),
                                user.name,
                                user.full_name,
                                shift_start_str,
                                shift_end_str,
                                check_in_str,
                                check_out_str,
                                f"{working_hours:.2f}",
                                f"{overtime_hours:.2f}",
                                is_late_val,
                                is_early_val,
                                entry_status_label,
                                att.source if att.source else "",
                                att.updated_reason if att.updated_reason else "",
                            ])

        # BOM (\xef\xbb\xbf) を付与して保存
        csv_str = output.getvalue()
        csv_bytes = csv_str.encode("utf-8")
        bom = b"\xef\xbb\xbf"
        return bom + csv_bytes
