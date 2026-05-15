"""打刻・勤怠サービス。BE-01〜BE-04 のビジネスロジックを実装する。"""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.exceptions import KintConflictError, KintNotFoundError
from kint.models.attendance import Attendance, AttendanceChangeLog
from kint.models.card import Card
from kint.models.user import User
from kint.schemas.attendance import (
    AttendanceHistoryEntry,
    AttendanceHistoryResponse,
    AttendanceHistorySnapshot,
    AttendanceListResponse,
    AttendancePatchRequest,
    AttendanceRecord,
)
from kint.schemas.punch import PunchRequest, PunchResponse


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
        """指定日の勤怠レコードを返す。存在しない場合は None。"""
        result = await self.session.execute(
            select(Attendance).where(
                Attendance.user_id == user_id,
                Attendance.work_date == work_date,
            )
        )
        return result.scalar_one_or_none()

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

        work_date = request.occurred_at.date()
        attendance = await self._get_attendance_for_date(user.id, work_date)

        if attendance is None:
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
        elif attendance.check_out is None:
            await self._do_check_out(
                attendance=attendance,
                occurred_at=request.occurred_at,
                method=method,
                reason=request.reason,
                actor_user=user,
            )
            action = "check_out"
        else:
            raise KintConflictError(
                code="ALREADY_CHECKED_OUT",
                message="本日の出退勤はすでに完了しています",
                detail={"user_id": user.id, "work_date": str(work_date)},
            )

        await self.session.commit()

        action_label = "出勤" if action == "check_in" else "退勤"
        return PunchResponse(
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
