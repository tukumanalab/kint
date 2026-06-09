"""APScheduler を使った定期同期スケジューラ。"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from kint.db import AsyncSessionLocal

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

CALENDAR_SYNC_JOB_ID = "calendar_sync_daily"
AUTO_COMPLETE_JOB_ID = "missing_checkout_auto_complete_daily"


async def _run_calendar_sync() -> None:
    """スケジューラから呼ばれる iCal 同期ジョブ。"""
    from kint.services.calendar_sync import CalendarSyncError, CalendarSyncService

    async with AsyncSessionLocal() as session:
        service = CalendarSyncService(session)
        try:
            stats = await service.sync()
            logger.info("定期同期完了: %s", stats)
        except CalendarSyncError as exc:
            logger.error("定期同期失敗: %s", exc)
        except Exception as exc:
            logger.exception("定期同期で予期しないエラー: %s", exc)


async def _run_missing_checkout_auto_complete() -> None:
    """スケジューラから呼ばれる退勤自動補完ジョブ。"""
    from kint.services.attendance import AttendanceService

    async with AsyncSessionLocal() as session:
        service = AttendanceService(session)
        try:
            stats = await service.auto_complete_missing_checkouts()
            logger.info("定期退勤自動補完完了: %s", stats)
        except Exception as exc:
            logger.exception("定期退勤自動補完で予期しないエラー: %s", exc)


def reschedule_calendar_sync(time_str: str | None) -> None:
    """既存ジョブを削除し、指定時刻で再登録する。None の場合はジョブ削除のみ。"""
    if scheduler.get_job(CALENDAR_SYNC_JOB_ID):
        scheduler.remove_job(CALENDAR_SYNC_JOB_ID)
        logger.info("定期同期ジョブを削除しました")

    if not time_str:
        logger.info("shift_sync_time が未設定のため定期同期を無効にしました")
        return

    hour, minute = time_str.split(":")
    scheduler.add_job(
        _run_calendar_sync,
        trigger=CronTrigger(hour=int(hour), minute=int(minute)),
        id=CALENDAR_SYNC_JOB_ID,
        replace_existing=True,
    )
    logger.info("定期同期ジョブを登録しました: %s", time_str)


async def init_scheduler() -> None:
    """起動時初期化。DB から shift_sync_time を取得してジョブを登録し scheduler を起動する。"""
    from kint.services.settings import SettingsService

    try:
        async with AsyncSessionLocal() as session:
            sync_time = await SettingsService(session).get_str("shift_sync_time")
    except Exception as exc:
        logger.warning("shift_sync_time 取得失敗。定期同期を無効にして起動します: %s", exc)
        sync_time = None

    if sync_time:
        reschedule_calendar_sync(sync_time)
    else:
        logger.info("shift_sync_time が未設定のため定期同期は無効です")

    # 毎日午前 4:00 に自動補完バッチを実行
    if not scheduler.get_job(AUTO_COMPLETE_JOB_ID):
        scheduler.add_job(
            _run_missing_checkout_auto_complete,
            trigger=CronTrigger(hour=4, minute=0),
            id=AUTO_COMPLETE_JOB_ID,
            replace_existing=True,
        )
        logger.info("定期退勤自動補完ジョブを登録しました: 04:00")

    scheduler.start()
    logger.info("スケジューラを起動しました")
