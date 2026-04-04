"""シフトモデル。"""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kint.db import Base


class Shift(Base):
    """Google Calendar から取得したシフト情報。"""

    __tablename__ = "shifts"
    __table_args__ = (UniqueConstraint("google_event_id", name="uq_shifts_google_event_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shift_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    google_event_id: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="shifts")  # noqa: F821
    attendances: Mapped[list["Attendance"]] = relationship(  # noqa: F821
        "Attendance",
        primaryjoin="Shift.shift_date == foreign(Attendance.work_date)",
        foreign_keys="[Shift.shift_date]",
        viewonly=True,
    )
