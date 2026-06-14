"""お知らせサービス。"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from kint.exceptions import KintNotFoundError
from kint.models.notification import Notification


class NotificationService:
    """お知らせ（通知）の作成・取得・既読化・自動クリーンアップを行うサービス。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_notification(
        self,
        user_id: str,
        message: str,
        category: str | None = None,
        reference_id: str | None = None,
    ) -> Notification:
        """指定ユーザー宛てにお知らせを作成する。"""
        notification = Notification(
            id=str(uuid.uuid4()),
            user_id=user_id,
            message=message,
            is_read=False,
            category=category,
            reference_id=reference_id,
            created_at=datetime.now(tz=UTC),
        )
        self.session.add(notification)
        await self.session.flush()
        return notification

    async def list_notifications(self, user_id: str) -> tuple[list[Notification], int]:
        """ユーザー宛てのお知らせ一覧を取得（新着順）し、未読件数も返す。"""
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
        )
        result = await self.session.execute(stmt)
        items = list(result.scalars().all())

        unread_stmt = select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.is_read == 0
        )
        unread_result = await self.session.execute(unread_stmt)
        unread_count = unread_result.scalar_one()

        return items, unread_count

    async def mark_as_read(self, user_id: str, notification_id: str) -> Notification:
        """指定したお知らせを既読にする。"""
        stmt = select(Notification).where(
            Notification.id == notification_id, Notification.user_id == user_id
        )
        result = await self.session.execute(stmt)
        notification = result.scalar_one_or_none()
        if notification is None:
            raise KintNotFoundError(
                code="NOTIFICATION_NOT_FOUND",
                message=f"お知らせ '{notification_id}' が見つかりません。",
            )

        notification.is_read = True
        await self.session.commit()
        return notification

    async def mark_all_as_read(self, user_id: str) -> None:
        """ユーザー宛てのすべてのお知らせを既読にする。"""
        stmt = (
            update(Notification)
            .where(Notification.user_id == user_id, Notification.is_read == 0)
            .values(is_read=True)
        )
        await self.session.execute(stmt)
        await self.session.commit()

    async def has_unread_notifications(self, user_id: str) -> bool:
        """ユーザーに未読のお知らせが存在するかどうかを返す。"""
        stmt = select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.is_read == 0
        )
        result = await self.session.execute(stmt)
        count = result.scalar_one()
        return count > 0

    async def cleanup_old_notifications(self, days: int = 180) -> int:
        """指定日数（デフォルト180日）以上経過した古いお知らせを削除する。"""
        threshold = datetime.now(tz=UTC) - timedelta(days=days)
        stmt = delete(Notification).where(Notification.created_at < threshold)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount
