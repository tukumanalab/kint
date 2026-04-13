"""メール確認リクエストモデル。"""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kint.db import Base


class EmailVerificationRequest(Base):
    """signup / email_change の確認トークンを管理するテーブル。トークンはハッシュ化して保存する。"""

    __tablename__ = "email_verification_requests"
    __table_args__ = (
        CheckConstraint(
            "verification_type IN ('signup', 'email_change')",
            name="ck_email_verification_requests_verification_type",
        ),
        CheckConstraint(
            "sent_via IN ('gmail_api')",
            name="ck_email_verification_requests_sent_via",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    requested_email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    verification_type: Mapped[str] = mapped_column(String, nullable=False)
    token_hash: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    requested_by_user_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    sent_via: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(  # noqa: F821
        back_populates="email_verification_requests", foreign_keys=[user_id]
    )
    requested_by: Mapped["User | None"] = relationship(  # noqa: F821
        foreign_keys=[requested_by_user_id]
    )
