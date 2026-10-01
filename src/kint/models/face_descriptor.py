"""顔認証打刻用ディスクリプタモデル。"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from kint.db import Base


class FaceDescriptor(Base):
    """顔認証用の128次元特徴量ディスクリプタ（float32 バイナリで保持し、写真は保存しない）。"""

    __tablename__ = "face_descriptors"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    descriptor: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="face_descriptors")  # noqa: F821
