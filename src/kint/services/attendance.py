"""打刻・勤怠サービス。BE-01〜BE-04 のビジネスロジックを実装する。"""

import calendar
import csv
import io
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from kint.exceptions import (
    KintBadRequestError,
    KintConflictError,
    KintForbiddenError,
    KintNotFoundError,
)
from kint.models.attendance import (
    Attendance,
    AttendanceChangeLog,
    AttendanceCorrectionRequest,
    AttendanceLock,
)
from kint.models.card import Card
from kint.models.shift import Shift
from kint.models.user import User
from kint.schemas.attendance import (
    AttendanceCorrectionRequestCreate,
    AttendanceCreateRequest,
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
    ShiftPeriod,
)
from kint.schemas.punch import PunchRequest, PunchResponse
from kint.services.settings import SettingsService


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def calculate_working_time(
    check_in: datetime | None,
    check_out: datetime | None,
    shift_start: datetime | None,
    shift_end: datetime | None,
) -> tuple[datetime | None, datetime | None]:
    """打刻時刻から勤務時間の出勤/退勤時刻を計算する。"""
    calc_in = None
    calc_out = None

    if check_in is not None:
        dt_in = check_in.replace(microsecond=0)
        if shift_start is not None and dt_in <= shift_start:
            # シフト開始前の打刻はシフト開始時刻とする
            calc_in = shift_start
        else:
            # シフト開始後、またはシフトなしの打刻は5分区切りで切り上げ
            base = dt_in.replace(hour=0, minute=0, second=0)
            delta_seconds = int((dt_in - base).total_seconds())
            remainder = delta_seconds % 300
            if remainder > 0:
                calc_in = dt_in + timedelta(seconds=(300 - remainder))
            else:
                calc_in = dt_in

    if check_out is not None:
        dt_out = check_out.replace(microsecond=0)
        if shift_end is not None and dt_out >= shift_end:
            # シフト終了後の打刻はシフト終了時刻とする
            calc_out = shift_end
        else:
            # シフト終了前、またはシフトなしの打刻は5分区切りで切り捨て
            base = dt_out.replace(hour=0, minute=0, second=0)
            delta_seconds = int((dt_out - base).total_seconds())
            remainder = delta_seconds % 300
            calc_out = dt_out - timedelta(seconds=remainder)

    return calc_in, calc_out



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

    async def _find_active_shift(self, user_id: str, occurred_at: datetime) -> Shift | None:
        """打刻時刻に対応するシフトを検索する。"""
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
            # 退勤はシフト終了後少し遅くなることがあるため、終了後4時間までカバーする
            if start <= occurred_utc <= (end + timedelta(hours=4)):
                return shift

        # 被るシフトが見つからない場合は、打刻日当日のシフトをデフォルトとする
        for shift in shifts:
            if shift.shift_date == occurred_date:
                return shift
        return None

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

        # 5分以内の退勤打刻の場合、出勤記録を取り消す（削除する）
        is_cancelled = False
        if attendance is not None and attendance.check_in is not None:
            diff_seconds = (self._as_utc(request.occurred_at) - self._as_utc(attendance.check_in)).total_seconds()
            if diff_seconds <= 300:
                is_cancelled = True

        if is_cancelled and attendance is not None:
            # 締め（ロック）チェック
            att_svc = AttendanceService(self.session)
            if await att_svc.is_date_locked(attendance.work_date):
                raise KintBadRequestError(
                    code="ATTENDANCE_LOCKED",
                    message="対象年月の勤怠は締め処理が完了しているため、打刻取り消しは行えません。",
                )
            # 関連するチェンジログを削除
            await self.session.execute(
                delete(AttendanceChangeLog).where(AttendanceChangeLog.attendance_id == attendance.id)
            )
            # 勤怠レコードを削除
            await self.session.delete(attendance)
            await self.session.commit()

            from kint.services.notification import NotificationService
            notif_svc = NotificationService(self.session)
            has_unread = await notif_svc.has_unread_notifications(user.id)

            return PunchResponse(
                status="completed",
                attendance_id=None,
                user_id=user.id,
                user_name=user.name,
                action="cancelled",
                occurred_at=request.occurred_at,
                method=method,  # type: ignore[arg-type]
                message="出勤打刻を取り消しました（5分以内の退勤）",
                has_unread_notifications=has_unread,
            )


        if attendance is not None:
            # 締め（ロック）チェック
            att_svc = AttendanceService(self.session)
            if await att_svc.is_date_locked(attendance.work_date):
                raise KintBadRequestError(
                    code="ATTENDANCE_LOCKED",
                    message="対象年月の勤怠は締め処理が完了しているため、退勤打刻は行えません。",
                )

            await self._do_check_out(
                attendance=attendance,
                occurred_at=request.occurred_at,
                method=method,
                reason=request.reason,
                actor_user=user,
            )
            action = "check_out"
        else:
            # 締め（ロック）チェック
            work_date = request.occurred_at.date()
            att_svc = AttendanceService(self.session)
            if await att_svc.is_date_locked(work_date):
                raise KintBadRequestError(
                    code="ATTENDANCE_LOCKED",
                    message="対象年月の勤怠は締め処理が完了しているため、出勤打刻は行えません。",
                )
 
            has_shift = await self._has_shift_for_check_in(user.id, request.occurred_at)
            if not has_shift and not request.confirm:
                settings_svc = SettingsService(self.session)
                ical_url = await settings_svc.get_str("shift_ical_url")
                sync_hint = "シフト同期設定あり" if ical_url else "SHIFT_ICAL_URL 未設定"
                from kint.services.notification import NotificationService
                notif_svc = NotificationService(self.session)
                has_unread = await notif_svc.has_unread_notifications(user.id)

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
                    has_unread_notifications=has_unread,
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
 
        # 丸め処理後の勤務出勤/退勤時刻および労働時間の計算
        calculated_time = None
        current_working_hours = None
        daily_working_hours_total = None
 
        active_shift = await self._find_active_shift(user.id, request.occurred_at)
        shift_start = active_shift.start_time if active_shift else None
        shift_end = active_shift.end_time if active_shift else None
 
        if action == "check_in":
            calc_in, _ = calculate_working_time(
                self._as_utc(request.occurred_at),
                None,
                _ensure_utc(shift_start),
                _ensure_utc(shift_end)
            )
            calculated_time = calc_in
        elif action == "check_out":
            calc_in, calc_out = calculate_working_time(
                self._as_utc(attendance.check_in),
                self._as_utc(request.occurred_at),
                _ensure_utc(shift_start),
                _ensure_utc(shift_end)
            )
            calculated_time = calc_out
            if calc_in and calc_out:
                current_working_hours = round((calc_out - calc_in).total_seconds() / 3600.0, 2)
 
            # その日の勤務時間合計を計算する（今回のレコードも含めて）
            stmt = select(Attendance).where(
                Attendance.user_id == user.id,
                Attendance.work_date == attendance.work_date
            )
            result = await self.session.execute(stmt)
            day_atts = result.scalars().all()
 
            daily_working_hours_total = 0.0
            shift_start_utc = _ensure_utc(shift_start)
            shift_end_utc = _ensure_utc(shift_end)
            for a in day_atts:
                a_cin = _ensure_utc(a.check_in)
                a_cout = _ensure_utc(a.check_out)
                c_in, c_out = calculate_working_time(
                    a_cin, a_cout, shift_start_utc, shift_end_utc
                )
                if c_in and c_out:
                    daily_working_hours_total += (c_out - c_in).total_seconds() / 3600.0
            daily_working_hours_total = round(daily_working_hours_total, 2)
 
        await self.session.commit()
 
        from kint.services.notification import NotificationService
        notif_svc = NotificationService(self.session)
        has_unread = await notif_svc.has_unread_notifications(user.id)

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
            calculated_time=calculated_time,
            current_working_hours=current_working_hours,
            daily_working_hours_total=daily_working_hours_total,
            has_unread_notifications=has_unread,
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

    async def _check_overlap(
        self,
        user_id: str,
        attendance_id: str | None,
        check_in: datetime | None,
        check_out: datetime | None,
    ) -> None:
        """指定したユーザーの他の勤怠記録と重複していないか検証する。"""
        if check_in is None:
            return

        # 同一ユーザーの他の（正常な出勤情報のある）勤怠記録を取得
        stmt = select(Attendance).where(
            Attendance.user_id == user_id,
            Attendance.check_in.isnot(None),
        )
        if attendance_id is not None:
            stmt = stmt.where(Attendance.id != attendance_id)

        result = await self.session.execute(stmt)
        other_attendances = result.scalars().all()

        req_in = _ensure_utc(check_in)
        req_out = _ensure_utc(check_out)

        # Type narrowing for Pylance:
        if req_in is None:
            return

        # req_in と req_out が不整合の場合 (退勤が出勤より前)
        if req_out is not None and req_out <= req_in:
            raise KintBadRequestError(
                code="INVALID_DATETIME_RANGE",
                message="退勤時刻は出勤時刻よりも後の時刻を指定してください。",
            )

        for other in other_attendances:
            other_in = _ensure_utc(other.check_in)
            other_out = _ensure_utc(other.check_out)

            # other_in も念のため None の場合はスキップ
            if other_in is None:
                continue

            # 重複判定ロジック
            overlap = False
            if req_out is not None and other_out is not None:
                if req_in < other_out and other_in < req_out:
                    overlap = True
            elif req_out is not None and other_out is None:
                if other_in < req_out:
                    overlap = True
            elif req_out is None and other_out is not None:
                if req_in < other_out:
                    overlap = True
            else:
                # 両方とも open-ended
                overlap = True

            if overlap:
                # ユーザーフレンドリーなエラーメッセージ（ローカル時刻 JST +09:00 に変換）
                from datetime import timezone, timedelta
                JST = timezone(timedelta(hours=9))
                local_in = other_in.astimezone(JST)
                local_out = other_out.astimezone(JST) if other_out else None

                in_str = local_in.strftime("%Y-%m-%d %H:%M:%S")
                out_str = local_out.strftime("%H:%M:%S") if local_out else "未退勤"
                raise KintBadRequestError(
                    code="ATTENDANCE_OVERLAP",
                    message=(
                        f"指定された時間帯は、別の勤怠記録 ({in_str} 〜 {out_str}) "
                        "と重複しています。"
                    ),
                )

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

        # 締め（ロック）チェック
        if await self.is_date_locked(attendance.work_date):
            raise KintBadRequestError(
                code="ATTENDANCE_LOCKED",
                message="対象年月の勤怠は締め処理が完了しているため、変更できません。",
            )

        now = datetime.now(tz=UTC)
        before_check_in = attendance.check_in
        before_check_out = attendance.check_out

        if patch.check_in is not None:
            attendance.check_in = patch.check_in
        if patch.check_out is not None:
            attendance.check_out = patch.check_out

        # 重複勤務時間のチェック
        await self._check_overlap(
            user_id=attendance.user_id,
            attendance_id=attendance.id,
            check_in=attendance.check_in,
            check_out=attendance.check_out,
        )

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
            key = (shift.user_id, shift.shift_date)
            if key not in shift_map:
                shift_map[key] = []
            shift_map[key].append(shift)

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
                day_shifts = shift_map.get((user.id, cur_date), [])
                day_shifts = sorted(day_shifts, key=lambda s: s.start_time)

                has_shift = len(day_shifts) > 0
                is_holiday = not has_shift and len(day_atts) == 0

                shift_start = day_shifts[0].start_time if day_shifts else None
                shift_end = day_shifts[-1].end_time if day_shifts else None

                # 全打刻中の最初出勤と最終退勤を抽出
                check_ins = [a.check_in for a in day_atts if a.check_in is not None]
                check_outs = [a.check_out for a in day_atts if a.check_out is not None]

                check_in = min(check_ins) if check_ins else None
                check_out = max(check_outs) if check_outs else None

                def ensure_utc(dt: datetime | None) -> datetime | None:
                    if dt is None:
                        return None
                    if dt.tzinfo is None:
                        return dt.replace(tzinfo=UTC)
                    return dt.astimezone(UTC)

                # 全てを UTC に正規化
                check_in_utc = ensure_utc(check_in)
                check_out_utc = ensure_utc(check_out)
                shift_start_utc = ensure_utc(shift_start)
                shift_end_utc = ensure_utc(shift_end)

                # 勤務時間（丸め後の出退勤時刻）を計算
                calc_check_in, calc_check_out = calculate_working_time(
                    check_in_utc, check_out_utc, shift_start_utc, shift_end_utc
                )

                working_hours = 0.0
                overtime_hours = 0.0

                # 実労働時間の計算（全ての打刻セグメントの勤務時間を合算）
                for a in day_atts:
                    if a.check_in and a.check_out:
                        a_cin_utc = ensure_utc(a.check_in)
                        a_cout_utc = ensure_utc(a.check_out)
                        c_in, c_out = calculate_working_time(
                            a_cin_utc, a_cout_utc, shift_start_utc, shift_end_utc
                        )
                        if c_in and c_out:
                            working_hours += (c_out - c_in).total_seconds() / 3600.0

                # 時間外労働時間の算出
                if has_shift and shift_end_utc and calc_check_out:
                    if calc_check_out > shift_end_utc:
                        overtime_hours = (calc_check_out - shift_end_utc).total_seconds() / 3600.0
                elif not has_shift and calc_check_in and calc_check_out:
                    if working_hours > 8.0:
                        overtime_hours = working_hours - 8.0

                # 遅刻／早退の判定（勤務時間の出退勤時刻に基づく）
                is_late = False
                is_early = False

                if has_shift and shift_start_utc and calc_check_in:
                    if calc_check_in > shift_start_utc:
                        is_late = True

                if has_shift and shift_end_utc and calc_check_out:
                    if calc_check_out < shift_end_utc:
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

                # 1日の中のすべての打刻ペアを時系列順（check_in昇順）に整理して格納
                sorted_atts = sorted(
                    day_atts,
                    key=lambda a: a.check_in if a.check_in else datetime.max.replace(tzinfo=UTC),
                )
                punches = []
                for a in sorted_atts:
                    p_cin = ensure_utc(a.check_in)
                    p_cout = ensure_utc(a.check_out)
                    p_calc_in, p_calc_out = calculate_working_time(
                        p_cin, p_cout, shift_start_utc, shift_end_utc
                    )
                    punches.append(
                        PunchPeriod(
                            attendance_id=a.id,
                            check_in=p_cin,
                            check_out=p_cout,
                            calculated_check_in=p_calc_in,
                            calculated_check_out=p_calc_out,
                            source=a.source,
                        )
                    )

                # attendance_id: その日の最初の打刻レコードのIDを使用（修正申請用）
                attendance_id = sorted_atts[0].id if sorted_atts else None
                is_auto_completed = any(a.is_auto_completed for a in day_atts)

                detail = DailyAttendanceDetail(
                    work_date=cur_date,
                    attendance_id=attendance_id,
                    has_shift=has_shift,
                    is_holiday=is_holiday,
                    shift_start=shift_start_utc,
                    shift_end=shift_end_utc,
                    check_in=check_in_utc,
                    check_out=check_out_utc,
                    calculated_check_in=calc_check_in,
                    calculated_check_out=calc_check_out,
                    working_hours=round(working_hours, 2) if is_valid_work else None,
                    overtime_hours=round(overtime_hours, 2) if overtime_hours > 0 else 0.0,
                    status=status,
                    source=source,
                    is_auto_completed=is_auto_completed,
                    punches=punches,
                    shifts=[
                        ShiftPeriod(
                            start_time=ensure_utc(s.start_time),  # type: ignore[arg-type]
                            end_time=ensure_utc(s.end_time),  # type: ignore[arg-type]
                        )
                        for s in day_shifts
                    ],
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
        is_locked = await self.is_month_locked(year_month)
        return AttendanceMonthlyDetailResponse(
            user_id=user_id,
            year_month=year_month,
            summary=summary,
            days=daily_details,
            is_locked=is_locked,
        )

    async def export_csv(self, year_month: str, scope: str = "detailed") -> bytes:
        """指定した年月の勤怠データをCSVフォーマットでエクスポートする。文字コードはBOM付きUTF-8(utf-8-sig)。"""
        data, att_map = await self._calculate_monthly_data(year_month)

        output = io.StringIO()
        writer = csv.writer(output, lineterminator="\n")

        if scope == "summary":
            writer.writerow(
                [
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
                ]
            )
            for _, summary, _ in data:
                writer.writerow(
                    [
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
                    ]
                )
        else:
            writer.writerow(
                [
                    "日付",
                    "表示名",
                    "氏名",
                    "シフト開始時刻",
                    "シフト終了時刻",
                    "出勤時間",
                    "退勤時間",
                    "勤務出勤",
                    "勤務退勤",
                    "実労働時間(h)",
                    "時間外労働時間(h)",
                    "遅刻判定",
                    "早退判定",
                    "勤怠ステータス",
                    "打刻ソース",
                    "修正理由",
                ]
            )

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
                    sorted_atts = sorted(day_atts, key=lambda a: ensure_utc(a.check_in) or max_dt)

                    if sorted_atts:
                        # 打刻がある場合：各打刻レコード(エントリー)毎に1行ずつ出力する
                        for idx, att in enumerate(sorted_atts):
                            check_in_str = fmt_dt(att.check_in)
                            check_out_str = fmt_dt(att.check_out)

                            # 勤務時間（丸め後の出退勤時刻）を計算
                            att_cin_utc = ensure_utc(att.check_in)
                            att_cout_utc = ensure_utc(att.check_out)
                            day_shift_start_utc = ensure_utc(day.shift_start)
                            day_shift_end_utc = ensure_utc(day.shift_end)

                            calc_cin, calc_cout = calculate_working_time(
                                att_cin_utc, att_cout_utc, day_shift_start_utc, day_shift_end_utc
                            )

                            # 実労働時間（このエントリー単体、丸め後ベース）
                            working_hours = 0.0
                            if calc_cin and calc_cout:
                                duration = (calc_cout - calc_cin).total_seconds()
                                working_hours = duration / 3600.0

                            # 時間外労働時間（このエントリー単体、丸め後ベース）
                            overtime_hours = 0.0
                            if day.has_shift and day_shift_end_utc and calc_cout:
                                if calc_cout > day_shift_end_utc:
                                    diff = calc_cout - day_shift_end_utc
                                    over_sec = diff.total_seconds()
                                    overtime_hours = over_sec / 3600.0
                            elif not day.has_shift and calc_cin and calc_cout:
                                if working_hours > 8.0:
                                    overtime_hours = working_hours - 8.0

                            # 遅刻判定：その日の最古の打刻エントリーで評価
                            is_late_val = "否"
                            if day.has_shift:
                                first_att = sorted_atts[0]
                                first_calc_cin, _ = calculate_working_time(
                                    ensure_utc(first_att.check_in),
                                    ensure_utc(first_att.check_out),
                                    day_shift_start_utc,
                                    day_shift_end_utc,
                                )
                                if first_calc_cin and day_shift_start_utc:
                                    if first_calc_cin > day_shift_start_utc:
                                        is_late_val = "意"  # ここは元のファイルでは "是" だった
                                        is_late_val = "是"
                            else:
                                is_late_val = "-"

                            # 早退判定：その日の最新の打刻エントリーで評価
                            is_early_val = "否"
                            if day.has_shift:
                                last_att = sorted_atts[-1]
                                _, last_calc_cout = calculate_working_time(
                                    ensure_utc(last_att.check_in),
                                    ensure_utc(last_att.check_out),
                                    day_shift_start_utc,
                                    day_shift_end_utc,
                                )
                                if last_calc_cout and day_shift_end_utc:
                                    if last_calc_cout < day_shift_end_utc:
                                        is_early_val = "是"
                            else:
                                is_early_val = "-"

                            # エントリーに特化したステータス
                            # もし att 自体が unfinished (check_out が NULL) なら "打刻漏れ"
                            entry_status_label = status_label
                            if att.check_in and not att.check_out:
                                entry_status_label = "打刻漏れ"

                            writer.writerow(
                                [
                                    day.work_date.strftime("%Y-%m-%d"),
                                    user.name,
                                    user.full_name,
                                    shift_start_str,
                                    shift_end_str,
                                    check_in_str,
                                    check_out_str,
                                    fmt_dt(calc_cin),
                                    fmt_dt(calc_cout),
                                    f"{working_hours:.2f}",
                                    f"{overtime_hours:.2f}",
                                    is_late_val,
                                    is_early_val,
                                    entry_status_label,
                                    att.source if att.source else "",
                                    att.updated_reason if att.updated_reason else "",
                                ]
                            )

        # BOM (\xef\xbb\xbf) を付与して保存
        csv_str = output.getvalue()
        csv_bytes = csv_str.encode("utf-8")
        bom = b"\xef\xbb\xbf"
        return bom + csv_bytes

    async def is_month_locked(self, year_month: str) -> bool:
        """指定した年月（YYYY-MM）が締め（ロック）されているか判定する。"""
        stmt = select(AttendanceLock).where(AttendanceLock.year_month == year_month)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def is_date_locked(self, target_date: date) -> bool:
        """指定した日付が属する年月が締め（ロック）されているか判定する。"""
        year_month = target_date.strftime("%Y-%m")
        return await self.is_month_locked(year_month)

    async def lock_month(self, year_month: str, actor_id: str) -> AttendanceLock:
        """指定した年月を締め（ロック）する。"""
        import re

        if not re.match(r"^\d{4}-\d{2}$", year_month):
            raise KintBadRequestError(
                code="INVALID_YEAR_MONTH", message="年月は YYYY-MM 形式で指定してください。"
            )

        if await self.is_month_locked(year_month):
            raise KintBadRequestError(
                code="ALREADY_LOCKED", message="この年月はすでに締め処理が完了しています。"
            )

        year, month = map(int, year_month.split("-"))
        _, last_day = calendar.monthrange(year, month)
        from_date = date(year, month, 1)
        to_date = date(year, month, last_day)

        # 対象年月の pending 申請を自動的に却下する
        stmt = (
            select(AttendanceCorrectionRequest)
            .join(Attendance)
            .where(
                Attendance.work_date >= from_date,
                Attendance.work_date <= to_date,
                AttendanceCorrectionRequest.status == "pending",
            )
        )
        res = await self.session.execute(stmt)
        pending_requests = res.scalars().all()

        now = datetime.now(tz=UTC)
        for req in pending_requests:
            req.status = "rejected"
            req.approved_by_user_id = actor_id
            req.approval_comment = (
                "当月の締め処理が完了したため、システムにより自動的に却下されました。"
            )
            req.updated_at = now

        lock = AttendanceLock(year_month=year_month, locked_by_user_id=actor_id, locked_at=now)
        self.session.add(lock)
        await self.session.commit()
        return lock

    async def unlock_month(self, year_month: str) -> None:
        """指定した年月の締め（ロック）を解除する。"""
        stmt = select(AttendanceLock).where(AttendanceLock.year_month == year_month)
        result = await self.session.execute(stmt)
        lock = result.scalar_one_or_none()
        if lock is None:
            raise KintNotFoundError(
                code="LOCK_NOT_FOUND", message="指定された年月の締め履歴はありません。"
            )

        await self.session.delete(lock)
        await self.session.commit()

    async def list_locks(self) -> list[AttendanceLock]:
        """締め（ロック）されている年月の一覧を返す。"""
        stmt = select(AttendanceLock).order_by(AttendanceLock.year_month.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    # ------------------------------------------------------------------
    # 勤怠修正申請（AttendanceCorrectionRequest）関連メソッド
    # ------------------------------------------------------------------

    async def create_correction_request(
        self, author_id: str, creator_role: str, body: AttendanceCorrectionRequestCreate
    ) -> AttendanceCorrectionRequest:
        """新規の修正申請を作成する。"""
        # 勤怠レコードの存在確認
        stmt = select(Attendance).where(Attendance.id == body.attendance_id)
        result = await self.session.execute(stmt)
        attendance = result.scalar_one_or_none()
        if attendance is None:
            raise KintNotFoundError(
                code="ATTENDANCE_NOT_FOUND",
                message=f"勤怠記録 '{body.attendance_id}' が見つかりません",
            )

        # 従業員ロールの場合は本人確認
        if creator_role == "employee" and attendance.user_id != author_id:
            raise KintForbiddenError(
                code="FORBIDDEN", message="自分以外の勤怠記録に対して申請することはできません。"
            )

        # ロック（締め）チェック
        if await self.is_date_locked(attendance.work_date):
            raise KintBadRequestError(
                code="ATTENDANCE_LOCKED",
                message="対象年月の勤怠は締め処理が完了しているため、申請は行えません。",
            )

        # 重複する pending 申請のチェック
        stmt_dup = select(AttendanceCorrectionRequest).where(
            AttendanceCorrectionRequest.attendance_id == body.attendance_id,
            AttendanceCorrectionRequest.status == "pending",
        )
        res_dup = await self.session.execute(stmt_dup)
        if res_dup.scalar_one_or_none() is not None:
            raise KintBadRequestError(
                code="PENDING_REQUEST_EXISTS", message="すでに承認待ちの申請が存在します。"
            )

        # 重複勤務時間のチェック
        await self._check_overlap(
            user_id=attendance.user_id,
            attendance_id=body.attendance_id,
            check_in=body.requested_check_in,
            check_out=body.requested_check_out,
        )

        # 5分以内チェック
        if body.requested_check_in is not None and body.requested_check_out is not None:
            req_in = _ensure_utc(body.requested_check_in)
            req_out = _ensure_utc(body.requested_check_out)
            if req_in is not None and req_out is not None:
                diff = (req_out - req_in).total_seconds()
                if 0 <= diff <= 300:
                    raise KintBadRequestError(
                        code="INVALID_DATETIME_RANGE",
                        message="出勤時刻から5分以内の退勤時刻への修正申請は受け付けられません。",
                    )

        # 申請作成
        now = datetime.now(tz=UTC)
        request = AttendanceCorrectionRequest(
            id=str(uuid.uuid4()),
            attendance_id=body.attendance_id,
            user_id=attendance.user_id,
            requested_check_in=body.requested_check_in,
            requested_check_out=body.requested_check_out,
            reason=body.reason,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        self.session.add(request)
        await self.session.commit()

        # 関連オブジェクトを明示的にロードした上で返却
        stmt_ref = (
            select(AttendanceCorrectionRequest)
            .where(AttendanceCorrectionRequest.id == request.id)
            .options(
                joinedload(AttendanceCorrectionRequest.user),
                joinedload(AttendanceCorrectionRequest.approved_by),
                joinedload(AttendanceCorrectionRequest.attendance),
            )
        )
        res_ref = await self.session.execute(stmt_ref)
        return res_ref.scalar_one()

    async def list_correction_requests(
        self, status: str | None = None, user_id: str | None = None
    ) -> list[AttendanceCorrectionRequest]:
        """修正申請一覧を返す。関係オブジェクトをロードして人名や対象日を読み出せるようにする。"""
        stmt = (
            select(AttendanceCorrectionRequest)
            .join(Attendance, AttendanceCorrectionRequest.attendance_id == Attendance.id)
            .options(
                joinedload(AttendanceCorrectionRequest.user),
                joinedload(AttendanceCorrectionRequest.approved_by),
                joinedload(AttendanceCorrectionRequest.attendance),
            )
        )

        if status is not None:
            stmt = stmt.where(AttendanceCorrectionRequest.status == status)
        if user_id is not None:
            stmt = stmt.where(AttendanceCorrectionRequest.user_id == user_id)

        stmt = stmt.order_by(
            Attendance.work_date.desc(), AttendanceCorrectionRequest.created_at.desc()
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def approve_correction_request(
        self, request_id: str, actor: User, comment: str | None
    ) -> AttendanceCorrectionRequest:
        """申請を承認し、同一トランザクション内で勤怠レコードを上書き更新、監査ログを出力する。"""
        stmt = select(AttendanceCorrectionRequest).where(
            AttendanceCorrectionRequest.id == request_id
        )
        result = await self.session.execute(stmt)
        request = result.scalars().first()
        if request is None:
            raise KintNotFoundError(
                code="REQUEST_NOT_FOUND", message=f"申請ID '{request_id}' が見つかりません。"
            )

        if request.status != "pending":
            raise KintBadRequestError(
                code="INVALID_REQUEST_STATUS", message="承認待ちではない申請は処理できません。"
            )

        # 勤怠を取得
        stmt_att = select(Attendance).where(Attendance.id == request.attendance_id)
        res_att = await self.session.execute(stmt_att)
        attendance = res_att.scalar_one_or_none()
        if attendance is None:
            raise KintNotFoundError(
                code="ATTENDANCE_NOT_FOUND", message="対象の勤怠記録が見つかりません。"
            )

        # ロック（締め）チェック
        if await self.is_date_locked(attendance.work_date):
            raise KintBadRequestError(
                code="ATTENDANCE_LOCKED",
                message="対象年月の勤怠は締め処理が完了しているため、承認できません。",
            )

        now = datetime.now(tz=UTC)
        before_check_in = attendance.check_in
        before_check_out = attendance.check_out

        # 勤怠更新
        attendance.check_in = request.requested_check_in
        attendance.check_out = request.requested_check_out
        attendance.updated_reason = request.reason
        attendance.last_updated_by_user_id = actor.id
        attendance.last_updated_at = now

        # 重複勤務時間のチェック
        await self._check_overlap(
            user_id=attendance.user_id,
            attendance_id=attendance.id,
            check_in=attendance.check_in,
            check_out=attendance.check_out,
        )

        # 監査ログの追加
        log_reason = request.reason
        if comment:
            log_reason += f" (承認時コメント: {comment})"

        log = AttendanceChangeLog(
            id=str(uuid.uuid4()),
            attendance_id=attendance.id,
            actor_user_id=actor.id,
            actor_role=actor.role,
            before_check_in=before_check_in,
            before_check_out=before_check_out,
            after_check_in=request.requested_check_in,
            after_check_out=request.requested_check_out,
            reason=log_reason,
            changed_at=now,
        )
        self.session.add(log)

        # 申請ステータス変更
        request.status = "approved"
        request.approved_by_user_id = actor.id
        request.approval_comment = comment
        request.updated_at = now

        await self.session.commit()

        # 関連オブジェクトを明示的にロードした上で返却
        stmt_ref = (
            select(AttendanceCorrectionRequest)
            .where(AttendanceCorrectionRequest.id == request.id)
            .options(
                joinedload(AttendanceCorrectionRequest.user),
                joinedload(AttendanceCorrectionRequest.approved_by),
                joinedload(AttendanceCorrectionRequest.attendance),
            )
        )
        res_ref = await self.session.execute(stmt_ref)
        return res_ref.scalar_one()

    async def reject_correction_request(
        self, request_id: str, actor: User, comment: str
    ) -> AttendanceCorrectionRequest:
        """申請を却下する（勤怠レコードは変更しない）。"""
        stmt = select(AttendanceCorrectionRequest).where(
            AttendanceCorrectionRequest.id == request_id
        )
        result = await self.session.execute(stmt)
        request = result.scalars().first()
        if request is None:
            raise KintNotFoundError(
                code="REQUEST_NOT_FOUND", message=f"申請ID '{request_id}' が見つかりません。"
            )

        if request.status != "pending":
            raise KintBadRequestError(
                code="INVALID_REQUEST_STATUS", message="承認待ちではない申請は処理できません。"
            )

        # 勤怠を取得してロック状態のチェック
        stmt_att = select(Attendance).where(Attendance.id == request.attendance_id)
        res_att = await self.session.execute(stmt_att)
        attendance = res_att.scalar_one_or_none()
        if attendance is not None:
            if await self.is_date_locked(attendance.work_date):
                raise KintBadRequestError(
                    code="ATTENDANCE_LOCKED",
                    message="対象年月の勤怠は締め処理が完了しているため、却下できません。",
                )

        now = datetime.now(tz=UTC)
        request.status = "rejected"
        request.approved_by_user_id = actor.id
        request.approval_comment = comment
        request.updated_at = now

        # 却下お知らせ（通知）の作成
        from kint.services.notification import NotificationService
        notif_svc = NotificationService(self.session)
        work_date_str = attendance.work_date.strftime("%Y-%m-%d") if attendance else request.created_at.strftime("%Y-%m-%d")
        reason_comment = comment.strip() if (comment and comment.strip()) else "（理由未記入）"
        message = f"{work_date_str} の勤怠修正申請が却下されました。理由: {reason_comment}"
        await notif_svc.create_notification(
            user_id=request.user_id,
            message=message,
            category="correction_rejected",
            reference_id=request.id,
        )

        await self.session.commit()


        # 関連オブジェクトを明示的にロードした上で返却
        stmt_ref = (
            select(AttendanceCorrectionRequest)
            .where(AttendanceCorrectionRequest.id == request.id)
            .options(
                joinedload(AttendanceCorrectionRequest.user),
                joinedload(AttendanceCorrectionRequest.approved_by),
                joinedload(AttendanceCorrectionRequest.attendance),
            )
        )
        res_ref = await self.session.execute(stmt_ref)
        return res_ref.scalar_one()

    async def cancel_correction_request(self, request_id: str, user_id: str, role: str) -> None:
        """申請をキャンセル（削除）する。"""
        stmt = select(AttendanceCorrectionRequest).where(
            AttendanceCorrectionRequest.id == request_id
        )
        result = await self.session.execute(stmt)
        request = result.scalars().first()
        if request is None:
            raise KintNotFoundError(
                code="REQUEST_NOT_FOUND", message=f"申請ID '{request_id}' が見つかりません。"
            )

        if request.status != "pending":
            raise KintBadRequestError(
                code="INVALID_REQUEST_STATUS",
                message="承認待ちではない申請はキャンセルできません。",
            )

        # 一般従業員なら申請者本人チェック
        if role == "employee" and request.user_id != user_id:
            raise KintForbiddenError(
                code="FORBIDDEN", message="他人の申請をキャンセルすることはできません。"
            )

        # 勤怠を取得してロックチェック
        stmt_att = select(Attendance).where(Attendance.id == request.attendance_id)
        res_att = await self.session.execute(stmt_att)
        attendance = res_att.scalar_one_or_none()
        if attendance is not None:
            if await self.is_date_locked(attendance.work_date):
                raise KintBadRequestError(
                    code="ATTENDANCE_LOCKED",
                    message="対象年月の勤怠は締め処理が完了しているため、キャンセルできません。",
                )

        await self.session.delete(request)
        await self.session.commit()

    async def auto_complete_missing_checkouts(self) -> dict[str, int]:
        """前日以前の未退勤レコード（check_inあり、check_outがNULL）を自動補完する。

        シフトが存在する場合は、シフト終了予定時刻を退勤時間とし、is_auto_completed=True に設定。
        監査ログ（AttendanceChangeLog）を actor_user_id='system' で保存する。
        シフトが存在しない場合は、補完を行わず incomplete 状態のままとする。

        Returns:
            dict[str, int]: { "processed": 補完成功件数, "skipped": 補完対象外件数 }
        """
        import uuid
        from datetime import UTC, date, datetime

        today = date.today()
        # 前日以前の未退勤レコードを抽出
        stmt = select(Attendance).where(
            Attendance.work_date < today,
            Attendance.check_in.isnot(None),
            Attendance.check_out.is_(None),
        )
        result = await self.session.execute(stmt)
        attendances = result.scalars().all()

        processed = 0
        skipped = 0

        # system ユーザーが存在することを確認する
        result_system = await self.session.execute(select(User).where(User.id == "system"))
        system_user = result_system.scalar_one_or_none()
        if system_user is None:
            system_user = User(
                id="system",
                name="system",
                full_name="System Automatic Processor",
                email="system@kint.local",
                role="admin",
                is_active=1,
            )
            self.session.add(system_user)
            await self.session.flush()

        now = datetime.now(tz=UTC)

        for att in attendances:
            # 該当日の該当ユーザーのシフトを取得
            stmt_shift = select(Shift).where(
                Shift.user_id == att.user_id, Shift.shift_date == att.work_date
            )
            result_shift = await self.session.execute(stmt_shift)
            shift = result_shift.scalar_one_or_none()

            if shift is not None and shift.end_time is not None:
                before_check_in = att.check_in
                # シフトの終了時刻で補完
                att.check_out = (
                    shift.end_time.replace(tzinfo=UTC)
                    if shift.end_time.tzinfo is None
                    else shift.end_time.astimezone(UTC)
                )
                att.is_auto_completed = True
                att.auto_completed_at = now
                att.updated_reason = "退勤忘れのためシフト終了時刻でシステム自動補完"
                att.last_updated_by_user_id = "system"
                att.last_updated_at = now

                # 監査ログを追加
                log = AttendanceChangeLog(
                    id=str(uuid.uuid4()),
                    attendance_id=att.id,
                    actor_user_id="system",
                    actor_role="admin",
                    before_check_in=before_check_in,
                    before_check_out=None,
                    after_check_in=before_check_in,
                    after_check_out=att.check_out,
                    reason="退勤忘れのためシフト終了時刻でシステム自動補完",
                    changed_at=now,
                )
                self.session.add(log)
                processed += 1
            else:
                skipped += 1

        if processed > 0:
            await self.session.commit()

        return {"processed": processed, "skipped": skipped}

    async def create_attendance_manually(
        self,
        request: AttendanceCreateRequest,
        actor: User,
    ) -> AttendanceRecord:
        """管理者が手動で従業員の勤怠記録を追加する。"""
        # ロックチェック
        if await self.is_date_locked(request.work_date):
            raise KintBadRequestError(
                code="ATTENDANCE_LOCKED",
                message="対象年月の勤怠は締め処理が完了しているため、追加できません。",
            )

        # 重複チェック
        await self._check_overlap(
            user_id=request.user_id,
            attendance_id=None,
            check_in=request.check_in,
            check_out=request.check_out,
        )

        now = datetime.now(tz=UTC)
        attendance = Attendance(
            id=str(uuid.uuid4()),
            user_id=request.user_id,
            work_date=request.work_date,
            check_in=request.check_in,
            check_out=request.check_out,
            source="admin_manual",
            updated_reason=request.reason,
            last_updated_by_user_id=actor.id,
            last_updated_at=now,
        )
        self.session.add(attendance)
        await self.session.flush()

        # 監査ログを記録
        log = AttendanceChangeLog(
            id=str(uuid.uuid4()),
            attendance_id=attendance.id,
            actor_user_id=actor.id,
            actor_role=actor.role,
            before_check_in=None,
            before_check_out=None,
            after_check_in=attendance.check_in,
            after_check_out=attendance.check_out,
            reason=request.reason,
            changed_at=now,
        )
        self.session.add(log)
        await self.session.commit()

        return AttendanceRecord.model_validate(attendance)

    async def delete_attendance(
        self,
        attendance_id: str,
        actor: User,
    ) -> None:
        """管理者が勤怠記録を削除する。"""
        result = await self.session.execute(
            select(Attendance).where(Attendance.id == attendance_id)
        )
        attendance = result.scalar_one_or_none()
        if attendance is None:
            raise KintNotFoundError(
                code="ATTENDANCE_NOT_FOUND",
                message=f"勤怠記録 '{attendance_id}' が見つかりません",
            )

        # ロックチェック
        if await self.is_date_locked(attendance.work_date):
            raise KintBadRequestError(
                code="ATTENDANCE_LOCKED",
                message="対象年月の勤怠は締め処理が完了しているため、削除できません。",
            )

        # 関連するチェンジログを削除
        await self.session.execute(
            delete(AttendanceChangeLog).where(AttendanceChangeLog.attendance_id == attendance.id)
        )
        # 勤怠レコードを削除
        await self.session.delete(attendance)
        await self.session.commit()
