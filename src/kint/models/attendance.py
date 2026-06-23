"""勤怠・勤怠変更履歴モデル。"""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kint.db import Base

# source の許容値。Web アプリ対応で webusb_nfc / web_user_id に変更
_SOURCE_CHECK = "source IN ('webusb_nfc', 'web_user_id', 'admin_manual', 'self_service')"


class Attendance(Base):
    """出退勤記録。"""

    __tablename__ = "attendances"
    __table_args__ = (
        CheckConstraint(_SOURCE_CHECK, name="ck_attendances_source"),
        CheckConstraint(
            "check_out IS NULL OR check_out > check_in",
            name="ck_attendances_checkout_after_checkin",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    card_idm: Mapped[str | None] = mapped_column(String, nullable=True)
    work_date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    check_in: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    check_out: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    work_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    work_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_manual_work_time: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    source: Mapped[str] = mapped_column(String, nullable=False)
    updated_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    is_auto_completed: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0", nullable=False
    )
    auto_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_updated_by_user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    last_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(  # noqa: F821
        back_populates="attendances", foreign_keys=[user_id]
    )
    card: Mapped["Card | None"] = relationship(  # noqa: F821
        back_populates="attendances",
        primaryjoin="foreign(Attendance.card_idm) == Card.card_idm",
        foreign_keys="[Attendance.card_idm]",
    )
    change_logs: Mapped[list["AttendanceChangeLog"]] = relationship(back_populates="attendance")
    correction_requests: Mapped[list["AttendanceCorrectionRequest"]] = relationship(
        back_populates="attendance", cascade="all, delete-orphan"
    )


class AttendanceChangeLog(Base):
    """勤怠変更履歴（不変ログ）。INSERT のみ、UPDATE/DELETE は行わない。"""

    __tablename__ = "attendance_change_logs"
    __table_args__ = (
        CheckConstraint(
            "actor_role IN ('admin', 'employee')", name="ck_attendance_change_logs_actor_role"
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    attendance_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("attendances.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    actor_user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    actor_role: Mapped[str] = mapped_column(String, nullable=False)
    before_check_in: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    before_check_out: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    after_check_in: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    after_check_out: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    before_work_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    before_work_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    after_work_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    after_work_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), index=True
    )

    attendance: Mapped["Attendance"] = relationship(back_populates="change_logs")
    actor: Mapped["User"] = relationship(  # noqa: F821
        back_populates="attendance_change_logs", foreign_keys=[actor_user_id]
    )


class AttendanceCorrectionRequest(Base):
    """勤怠修正申請モデル。"""

    __tablename__ = "attendance_correction_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_attendance_correction_requests_status",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    attendance_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("attendances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    requested_check_in: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    requested_check_out: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="pending")
    approved_by_user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approval_comment: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    attendance: Mapped["Attendance"] = relationship(back_populates="correction_requests")
    user: Mapped["User"] = relationship(  # noqa: F821
        foreign_keys=[user_id]
    )
    approved_by: Mapped["User | None"] = relationship(  # noqa: F821
        foreign_keys=[approved_by_user_id]
    )


class AttendanceLock(Base):
    """勤怠締め処理（ロック）モデル。"""

    __tablename__ = "attendance_locks"

    year_month: Mapped[str] = mapped_column(String, primary_key=True)
    locked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    locked_by_user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    locked_by: Mapped["User"] = relationship(  # noqa: F821
        foreign_keys=[locked_by_user_id]
    )
