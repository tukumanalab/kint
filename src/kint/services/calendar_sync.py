"""iCal シフトカレンダー同期サービス。"""

import asyncio
import logging
import urllib.request
import uuid
from datetime import UTC, date, datetime

from icalendar import Calendar, Event, vCalAddress, vDDDTypes
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.shift import Shift
from kint.models.user import User
from kint.services.settings import SettingsService

logger = logging.getLogger(__name__)


class CalendarSyncError(Exception):
    """同期処理中のエラー。"""


def _to_utc_datetime(val: vDDDTypes | datetime | date) -> datetime:
    """vDDDTypes / datetime / date を UTC datetime に変換する。"""
    dt = val.dt if isinstance(val, vDDDTypes) else val
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    # date のみの場合は 00:00 UTC として扱う
    return datetime(dt.year, dt.month, dt.day, tzinfo=UTC)


def _extract_email(attendee: vCalAddress | str) -> str | None:
    """ATTENDEE 値から MAILTO: メールアドレスを抽出する。"""
    value = str(attendee)
    prefix = "mailto:"
    if value.lower().startswith(prefix):
        return value[len(prefix) :]
    return None


def _fetch_ical_bytes(url: str) -> bytes:
    """iCal URL を同期的に取得する（スレッドプールで実行）。"""
    with urllib.request.urlopen(url, timeout=30) as resp:  # noqa: S310
        return resp.read()


class CalendarSyncService:
    """iCal データを取得・パースし shifts テーブルと同期するサービス。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def sync(self) -> dict[str, int]:
        """iCal を取得して shifts テーブルと同期する。

        Returns:
            inserted / updated / deleted / skipped の件数辞書。

        Raises:
            CalendarSyncError: SHIFT_ICAL_URL 未設定または HTTP 取得失敗時。
        """
        ical_url = await SettingsService(self.session).get_str("shift_ical_url")
        if not ical_url:
            raise CalendarSyncError("SHIFT_ICAL_URL が設定されていません")

        # iCal を非同期コンテキストで取得
        try:
            raw = await asyncio.to_thread(_fetch_ical_bytes, ical_url)
        except Exception as exc:
            raise CalendarSyncError(f"iCal の取得に失敗しました: {exc}") from exc

        cal = Calendar.from_ical(raw)
        today = date.today()

        inserted = updated = deleted = skipped = 0
        seen_uids: set[str] = set()

        for component in cal.walk():
            if not isinstance(component, Event):
                continue

            uid: str | None = str(component.get("UID")) if component.get("UID") else None
            dtstart = component.get("DTSTART")
            dtend = component.get("DTEND")

            if uid is None or dtstart is None or dtend is None:
                skipped += 1
                logger.warning(
                    "必須フィールドが欠落しているイベントをスキップします: %s", component
                )
                continue

            start_dt = _to_utc_datetime(dtstart)
            end_dt = _to_utc_datetime(dtend)
            shift_date = start_dt.date()

            # ATTENDEE からユーザーを解決
            attendees = component.get("ATTENDEE")
            if attendees is None:
                skipped += 1
                logger.warning("ATTENDEE が存在しないイベントをスキップします: uid=%s", uid)
                continue

            # attendees は単一値またはリストのどちらもあり得る
            if not isinstance(attendees, list):
                attendees = [attendees]

            user_id: str | None = None
            for att in attendees:
                email = _extract_email(att)
                if email is None:
                    continue
                result = await self.session.execute(
                    select(User).where(User.email == email, User.is_active == 1)
                )
                user = result.scalar_one_or_none()
                if user is not None:
                    user_id = user.id
                    break

            if user_id is None:
                skipped += 1
                logger.warning(
                    "対応するユーザーが見つからないためイベントをスキップします: uid=%s", uid
                )
                continue

            seen_uids.add(uid)

            # Upsert
            result = await self.session.execute(select(Shift).where(Shift.google_event_id == uid))
            existing = result.scalar_one_or_none()

            if existing is None:
                new_shift = Shift(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    shift_date=shift_date,
                    start_time=start_dt,
                    end_time=end_dt,
                    google_event_id=uid,
                )
                self.session.add(new_shift)
                inserted += 1
            else:
                changed = (
                    existing.start_time.replace(tzinfo=UTC) != start_dt
                    or existing.end_time.replace(tzinfo=UTC) != end_dt
                    or existing.user_id != user_id
                    or existing.shift_date != shift_date
                )
                if changed:
                    existing.start_time = start_dt
                    existing.end_time = end_dt
                    existing.user_id = user_id
                    existing.shift_date = shift_date
                    updated += 1

        # 今日以降のシフトのうち iCal に存在しないものを削除
        if seen_uids:
            result = await self.session.execute(select(Shift).where(Shift.shift_date >= today))
            future_shifts = result.scalars().all()
            to_delete = [s for s in future_shifts if s.google_event_id not in seen_uids]
            for shift in to_delete:
                await self.session.delete(shift)
                deleted += 1
        else:
            # iCal が空の場合は安全のため削除を行わない
            logger.warning("取得した iCal にイベントが 0 件です。削除処理をスキップします")

        await self.session.commit()
        logger.info(
            "シフト同期完了: inserted=%d, updated=%d, deleted=%d, skipped=%d",
            inserted,
            updated,
            deleted,
            skipped,
        )
        return {"inserted": inserted, "updated": updated, "deleted": deleted, "skipped": skipped}
