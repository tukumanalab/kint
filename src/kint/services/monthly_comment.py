"""月次勤務サマリー コメント（管理者共有メモ）サービス。"""

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from kint.models.monthly_comment import AttendanceMonthlyComment
from kint.models.user import User
from kint.schemas.attendance import MonthlyCommentResponse, MonthlyCommentUpsertRequest


class MonthlyCommentService:
    """月次勤務サマリー コメント（管理者共有メモ）の取得・更新を行うサービス。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_comment(self, year_month: str) -> MonthlyCommentResponse:
        """指定年月のコメントを取得する。未登録の場合は空のレスポンスを返す。"""
        comment = await self._get(year_month)
        if comment is None:
            return MonthlyCommentResponse(year_month=year_month)
        return self._to_response(comment)

    async def upsert_comment(
        self, req: MonthlyCommentUpsertRequest, current_user: User
    ) -> MonthlyCommentResponse:
        """コメントを作成・更新する。空（strip 後）の本文の場合は行を削除する。"""
        body = req.body.strip()
        comment = await self._get(req.year_month)

        if not body:
            if comment is not None:
                await self.session.execute(
                    delete(AttendanceMonthlyComment).where(
                        AttendanceMonthlyComment.year_month == req.year_month
                    )
                )
                await self.session.commit()
            return MonthlyCommentResponse(year_month=req.year_month)

        if comment is None:
            comment = AttendanceMonthlyComment(
                year_month=req.year_month,
                body=body,
                updated_by_user_id=current_user.id,
            )
            self.session.add(comment)
        else:
            comment.body = body
            comment.updated_by_user_id = current_user.id
            comment.updated_at = datetime.now(UTC).replace(tzinfo=None)

        await self.session.commit()
        await self.session.refresh(comment, attribute_names=["updated_by", "updated_at"])
        return self._to_response(comment)

    async def _get(self, year_month: str) -> AttendanceMonthlyComment | None:
        """指定年月のコメント行を取得する（`updated_by` を joinedload）。"""
        result = await self.session.execute(
            select(AttendanceMonthlyComment)
            .options(joinedload(AttendanceMonthlyComment.updated_by))
            .where(AttendanceMonthlyComment.year_month == year_month)
        )
        return result.unique().scalar_one_or_none()

    def _to_response(self, comment: AttendanceMonthlyComment) -> MonthlyCommentResponse:
        """モデルからレスポンススキーマへ変換する。"""
        return MonthlyCommentResponse(
            year_month=comment.year_month,
            body=comment.body,
            updated_by_user_id=comment.updated_by_user_id,
            updated_by_name=comment.updated_by.name if comment.updated_by else None,
            updated_at=comment.updated_at,
        )
