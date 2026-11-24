"""APScheduler を使った定期同期スケジューラ。"""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from kint.db import AsyncSessionLocal

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

CALENDAR_SYNC_JOB_ID = "calendar_sync_daily"
CALENDAR_SYNC_INTERVAL_JOB_ID = "calendar_sync_interval"
AUTO_COMPLETE_JOB_ID = "missing_checkout_auto_complete_daily"
NOTIFICATION_CLEANUP_JOB_ID = "notification_cleanup_daily"
MONTHLY_REPORT_JOB_ID = "monthly_attendance_report"


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


async def _run_calendar_sync_interval() -> None:
    """日中の定期同期ジョブ。URL 未設定時は何もせず、直前に同期済みならスキップする。"""
    from kint.services.calendar_sync import CalendarSyncService

    async with AsyncSessionLocal() as session:
        await CalendarSyncService(session).refresh_if_stale(max_age_seconds=30, timeout=30)


async def _run_missing_checkout_auto_complete() -> None:
    """スケジューラから呼ばれる退勤自動補完ジョブ。補完前にシフトを最新化する。"""
    from kint.services.attendance import AttendanceService
    from kint.services.calendar_sync import CalendarSyncService

    async with AsyncSessionLocal() as session:
        # 当日に変更されたシフトの終了時刻で補完するため、先に同期する（失敗しても続行）
        await CalendarSyncService(session).refresh_if_stale(max_age_seconds=0, timeout=30)
        service = AttendanceService(session)
        try:
            stats = await service.auto_complete_missing_checkouts()
            logger.info("定期退勤自動補完完了: %s", stats)
        except Exception as exc:
            logger.exception("定期退勤自動補完で予期しないエラー: %s", exc)


async def _run_notification_cleanup() -> None:
    """スケジューラから呼ばれるお知らせ自動削除ジョブ。"""
    from kint.services.notification import NotificationService

    async with AsyncSessionLocal() as session:
        service = NotificationService(session)
        try:
            rowcount = await service.cleanup_old_notifications(days=180)
            logger.info("定期お知らせクリーンアップ完了: %d 件削除", rowcount)
        except Exception as exc:
            logger.exception("定期お知らせクリーンアップで予期しないエラー: %s", exc)


async def _run_monthly_attendance_report() -> None:
    """スケジューラから呼ばれる月次勤怠レポート通知ジョブ。"""

    from kint.services.attendance import AttendanceService

    logger.info("定期月次勤怠レポート通知バッチを開始します")
    async with AsyncSessionLocal() as session:
        service = AttendanceService(session)
        try:
            from datetime import datetime, timedelta, timezone

            JST = timezone(timedelta(hours=9))
            today = datetime.now(JST).date()

            stats = await service.send_monthly_attendance_reports(target_date=today)
            logger.info("定期月次勤怠レポート通知完了: %s", stats)

        except Exception as exc:
            logger.exception("定期月次勤怠レポート通知で予期しないエラー: %s", exc)


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


def reschedule_calendar_sync_interval(minutes: int | None) -> None:
    """日中の定期同期ジョブを指定間隔（分）で再登録する。0 / None の場合は削除のみ。"""
    if scheduler.get_job(CALENDAR_SYNC_INTERVAL_JOB_ID):
        scheduler.remove_job(CALENDAR_SYNC_INTERVAL_JOB_ID)
        logger.info("間隔指定の定期同期ジョブを削除しました")

    if not minutes or minutes <= 0:
        logger.info("shift_sync_interval_minutes が 0 のため間隔指定の定期同期を無効にしました")
        return

    scheduler.add_job(
        _run_calendar_sync_interval,
        trigger=IntervalTrigger(minutes=minutes),
        id=CALENDAR_SYNC_INTERVAL_JOB_ID,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    logger.info("間隔指定の定期同期ジョブを登録しました: %d 分ごと", minutes)


def reschedule_monthly_report(time_str: str | None) -> None:
    """既存ジョブを削除し、指定時刻で再登録する。None の場合はジョブ削除のみ。"""
    if scheduler.get_job(MONTHLY_REPORT_JOB_ID):
        scheduler.remove_job(MONTHLY_REPORT_JOB_ID)
        logger.info("定期月次勤怠レポート通知ジョブを削除しました")

    if not time_str:
        logger.info("monthly_report_time が未設定のため定期月次勤怠レポート通知を無効にしました")
        return

    hour, minute = time_str.split(":")
    scheduler.add_job(
        _run_monthly_attendance_report,
        trigger=CronTrigger(day="last", hour=int(hour), minute=int(minute)),
        id=MONTHLY_REPORT_JOB_ID,
        replace_existing=True,
    )
    logger.info("定期月次勤怠レポート通知ジョブを登録しました: %s (月末)", time_str)


async def init_scheduler() -> None:
    """起動時初期化。DB から各設定を取得してジョブを登録し scheduler を起動する。"""
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

    # 当日のシフト変更を反映するための日中の定期同期
    try:
        async with AsyncSessionLocal() as session:
            sync_interval = (await SettingsService(session).get_all()).shift_sync_interval_minutes
    except Exception as exc:
        logger.warning("shift_sync_interval_minutes 取得失敗。間隔同期を無効にします: %s", exc)
        sync_interval = 0
    reschedule_calendar_sync_interval(sync_interval)

    try:
        async with AsyncSessionLocal() as session:
            report_time = await SettingsService(session).get_str("monthly_report_time")
    except Exception as exc:
        logger.warning("monthly_report_time 取得失敗。デフォルト値 (20:00) を使用します: %s", exc)
        report_time = "20:00"

    if report_time:
        reschedule_monthly_report(report_time)
    else:
        logger.info("monthly_report_time が未設定のため定期月次勤怠レポート通知は無効です")

    # 毎日午前 4:00 に自動補完バッチを実行
    if not scheduler.get_job(AUTO_COMPLETE_JOB_ID):
        scheduler.add_job(
            _run_missing_checkout_auto_complete,
            trigger=CronTrigger(hour=4, minute=0),
            id=AUTO_COMPLETE_JOB_ID,
            replace_existing=True,
        )
        logger.info("定期退勤自動補完ジョブを登録しました: 04:00")

    # 毎日午前 4:05 にお知らせクリーンアップバッチを実行
    if not scheduler.get_job(NOTIFICATION_CLEANUP_JOB_ID):
        scheduler.add_job(
            _run_notification_cleanup,
            trigger=CronTrigger(hour=4, minute=5),
            id=NOTIFICATION_CLEANUP_JOB_ID,
            replace_existing=True,
        )
        logger.info("定期お知らせクリーンアップジョブを登録しました: 04:05")

    scheduler.start()
    logger.info("スケジューラを起動しました")
