"""ユーザーモデル。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kint.db import Base


class User(Base):
    """管理者・従業員のアカウント情報。"""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role IN ('admin', 'employee')", name="ck_users_role"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    google_calendar_id: Mapped[str | None] = mapped_column(String, nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    cards: Mapped[list["Card"]] = relationship(back_populates="user")  # noqa: F821
    attendances: Mapped[list["Attendance"]] = relationship(  # noqa: F821
        back_populates="user", foreign_keys="Attendance.user_id"
    )
    attendance_change_logs: Mapped[list["AttendanceChangeLog"]] = relationship(  # noqa: F821
        back_populates="actor", foreign_keys="AttendanceChangeLog.actor_user_id"
    )
    shifts: Mapped[list["Shift"]] = relationship(back_populates="user")  # noqa: F821
    profile_change_logs: Mapped[list["UserProfileChangeLog"]] = relationship(  # noqa: F821
        back_populates="user", foreign_keys="UserProfileChangeLog.user_id"
    )
    acted_profile_change_logs: Mapped[list["UserProfileChangeLog"]] = relationship(  # noqa: F821
        back_populates="actor", foreign_keys="UserProfileChangeLog.actor_user_id"
    )
    email_verification_requests: Mapped[list["EmailVerificationRequest"]] = relationship(  # noqa: F821
        back_populates="user", foreign_keys="EmailVerificationRequest.user_id"
    )
