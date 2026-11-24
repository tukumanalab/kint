"""iCal シフトカレンダー同期サービス。"""

import asyncio
import logging
import time
import urllib.request
import uuid
from datetime import UTC, date, datetime, timedelta, timezone

from icalendar import Calendar, Event, vCalAddress, vDDDTypes
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.models.shift import Shift
from kint.models.user import User
from kint.services.settings import SettingsService

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

# 打刻時の再同期で使う既定値（最終同期からの経過秒数・iCal 取得のタイムアウト秒数）
PUNCH_REFRESH_MAX_AGE_SECONDS = 60
PUNCH_REFRESH_TIMEOUT_SECONDS = 5.0

# 同期の多重実行防止ロックと最終成功時刻（time.monotonic()、プロセス内メモリ保持）
_sync_lock = asyncio.Lock()
_last_synced_at: float | None = None


def reset_sync_state() -> None:
    """最終同期時刻をクリアする（テスト用）。"""
    global _last_synced_at
    _last_synced_at = None


def _mark_synced() -> None:
    """同期成功時刻を記録する。"""
    global _last_synced_at
    _last_synced_at = time.monotonic()


def _is_fresh(max_age_seconds: float) -> bool:
    """最終同期から max_age_seconds 以内かを返す。"""
    if _last_synced_at is None:
        return False
    return time.monotonic() - _last_synced_at < max_age_seconds


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


def _fetch_ical_bytes(url: str, timeout: float = 30) -> bytes:
    """iCal URL を同期的に取得する（スレッドプールで実行）。"""
    with urllib.request.urlopen(url, timeout=timeout) as resp:  # noqa: S310
        return resp.read()


class CalendarSyncService:
    """iCal データを取得・パースし shifts テーブルと同期するサービス。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def refresh_if_stale(
        self,
        max_age_seconds: float = PUNCH_REFRESH_MAX_AGE_SECONDS,
        timeout: float = PUNCH_REFRESH_TIMEOUT_SECONDS,
    ) -> bool:
        """最終同期から max_age_seconds 以上経っていれば同期する。失敗しても例外は出さない。

        当日のシフト変更を打刻判定に反映するために使う。同期した場合は True を返す。
        """
        if _is_fresh(max_age_seconds):
            return False
        ical_url = await SettingsService(self.session).get_str("shift_ical_url")
        if not ical_url:
            return False
        async with _sync_lock:
            # 待っている間に別のリクエストが同期を済ませていれば取り直さない
            if _is_fresh(max_age_seconds):
                return False
            try:
                stats = await self.sync(timeout=timeout, _locked=True)
            except Exception as exc:
                logger.warning("シフトの再同期に失敗しました（既存のシフトで判定します）: %s", exc)
                # 取得・解析の失敗では DB は未変更。途中まで反映した場合のみ巻き戻す
                if self.session.new or self.session.dirty or self.session.deleted:
                    await self.session.rollback()
                return False
        logger.info("シフトを再同期しました: %s", stats)
        return True

    async def sync(self, timeout: float = 30, _locked: bool = False) -> dict[str, int]:
        """iCal を取得して shifts テーブルと同期する。

        現在から前後 2 週間（14 日）のシフトのみを同期対象とする。
        shift_date はシフト開始日時の JST の日付とする。

        Returns:
            inserted / updated / deleted / skipped の件数辞書。

        Raises:
            CalendarSyncError: SHIFT_ICAL_URL 未設定または HTTP 取得失敗時。
        """
        if _locked:
            return await self._sync_unlocked(timeout)
        async with _sync_lock:
            return await self._sync_unlocked(timeout)

    async def _sync_unlocked(self, timeout: float) -> dict[str, int]:
        """ロック取得済みの状態で同期本体を実行する。"""
        ical_url = await SettingsService(self.session).get_str("shift_ical_url")
        if not ical_url:
            raise CalendarSyncError("SHIFT_ICAL_URL が設定されていません")

        # iCal を非同期コンテキストで取得
        try:
            raw = await asyncio.to_thread(_fetch_ical_bytes, ical_url, timeout)
        except Exception as exc:
            raise CalendarSyncError(f"iCal の取得に失敗しました: {exc}") from exc

        cal = Calendar.from_ical(raw)
        today = datetime.now(JST).date()
        start_bound = today - timedelta(days=14)
        end_bound = today + timedelta(days=14)

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
            # 勤怠の work_date（JST）と突き合わせるため、JST の日付で保持する
            shift_date = start_dt.astimezone(JST).date()

            # 同期対象範囲（前後2週間）外のイベントはスキップ
            if not (start_bound <= shift_date <= end_bound):
                skipped += 1
                logger.debug(
                    "同期対象範囲（前後2週間）外のイベントをスキップします: uid=%s, shift_date=%s",
                    uid,
                    shift_date,
                )
                continue

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

        # 同期対象範囲（前後2週間）内のシフトのうち iCal に存在しないものを削除
        if seen_uids:
            result = await self.session.execute(
                select(Shift).where(
                    Shift.shift_date >= start_bound,
                    Shift.shift_date <= end_bound,
                )
            )
            range_shifts = result.scalars().all()
            to_delete = [s for s in range_shifts if s.google_event_id not in seen_uids]
            for shift in to_delete:
                await self.session.delete(shift)
                deleted += 1
        else:
            # iCal が空の場合は安全のため削除を行わない
            logger.warning("取得した iCal にイベントが 0 件です。削除処理をスキップします")

        await self.session.commit()
        _mark_synced()
        logger.info(
            "シフト同期完了: inserted=%d, updated=%d, deleted=%d, skipped=%d",
            inserted,
            updated,
            deleted,
            skipped,
        )
        return {"inserted": inserted, "updated": updated, "deleted": deleted, "skipped": skipped}
