"""月次勤務サマリー コメント（管理者共有メモ）モデル。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kint.db import Base


class AttendanceMonthlyComment(Base):
    """月次勤務サマリー（年月単位）の管理者共有メモ。年月につき1行。"""

    __tablename__ = "attendance_monthly_comments"

    year_month: Mapped[str] = mapped_column(String(7), primary_key=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by_user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    updated_by: Mapped["User | None"] = relationship(  # noqa: F821
        foreign_keys=[updated_by_user_id]
    )
