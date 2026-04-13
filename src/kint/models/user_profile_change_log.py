"""ユーザープロフィール変更監査ログモデル。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kint.db import Base


class UserProfileChangeLog(Base):
    """ユーザープロフィール変更の監査ログ（不変ログ）。INSERT のみ、UPDATE/DELETE は行わない。"""

    __tablename__ = "user_profile_change_logs"
    __table_args__ = (
        CheckConstraint(
            "actor_role IN ('admin', 'employee')",
            name="ck_user_profile_change_logs_actor_role",
        ),
        CheckConstraint(
            "event_type IN ('profile', 'password', 'email_change_requested', 'email_change_confirmed')",  # noqa: E501
            name="ck_user_profile_change_logs_event_type",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="RESTRICT"),
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
    event_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    before_email: Mapped[str | None] = mapped_column(String, nullable=True)
    after_email: Mapped[str | None] = mapped_column(String, nullable=True)
    before_name: Mapped[str | None] = mapped_column(String, nullable=True)
    after_name: Mapped[str | None] = mapped_column(String, nullable=True)
    before_full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    after_full_name: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), index=True
    )

    user: Mapped["User"] = relationship(  # noqa: F821
        back_populates="profile_change_logs", foreign_keys=[user_id]
    )
    actor: Mapped["User"] = relationship(  # noqa: F821
        back_populates="acted_profile_change_logs", foreign_keys=[actor_user_id]
    )
