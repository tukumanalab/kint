"""システム設定サービス。DB オーバーライドパターンで設定値を管理する。"""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from kint.config import settings as env_settings
from kint.models.system_setting import SystemSetting
from kint.schemas.settings import (
    SettingsExportFile,
    SettingsImportChange,
    SettingsImportRequest,
    SettingsImportResult,
    SettingsPatchRequest,
    SettingsResponse,
)

ALLOWED_SETTING_KEYS = {
    "punch_cooldown_seconds",
    "shift_checkin_early_minutes",
    "shift_ical_url",
    "shift_sync_time",
    "site_name",
    "site_subtitle",
    "punch_result_display_seconds",
    "monthly_report_time",
    "login_token_expire_hours",
}

_KNOWN_VERSION = "1"


class SettingsService:
    """システム設定の取得・更新・エクスポート・インポートを担う。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _load_db_map(self) -> dict[str, str]:
        """DB から全設定値を {key: value} として返す。"""
        result = await self.session.execute(select(SystemSetting))
        rows = result.scalars().all()
        return {row.key: row.value for row in rows}

    def _build_response(self, db_map: dict[str, str]) -> SettingsResponse:
        """DB 値を環境変数・デフォルト値で補完して SettingsResponse を返す。"""
        cooldown_raw = db_map.get("punch_cooldown_seconds")
        early_raw = db_map.get("shift_checkin_early_minutes")
        ical_raw = db_map.get("shift_ical_url")
        sync_time_raw = db_map.get("shift_sync_time")
        site_name_raw = db_map.get("site_name")
        site_subtitle_raw = db_map.get("site_subtitle")
        display_seconds_raw = db_map.get("punch_result_display_seconds")
        monthly_report_time_raw = db_map.get("monthly_report_time")
        login_token_expire_hours_raw = db_map.get("login_token_expire_hours")

        cooldown = (
            int(cooldown_raw) if cooldown_raw is not None else env_settings.punch_cooldown_seconds
        )
        early = (
            int(early_raw) if early_raw is not None else env_settings.shift_checkin_early_minutes
        )
        ical = ical_raw if ical_raw is not None else env_settings.shift_ical_url
        # 空文字列は null 扱い
        if ical == "":
            ical = None
        sync_time = sync_time_raw if sync_time_raw else None
        site_name = site_name_raw if site_name_raw is not None else env_settings.site_name
        site_subtitle = site_subtitle_raw if site_subtitle_raw is not None else env_settings.site_subtitle
        display_seconds = (
            int(display_seconds_raw)
            if display_seconds_raw is not None
            else env_settings.punch_result_display_seconds
        )
        monthly_report_time = (
            monthly_report_time_raw
            if monthly_report_time_raw is not None
            else env_settings.monthly_report_time
        )
        if monthly_report_time == "":
            monthly_report_time = None

        login_token_expire_hours = (
            int(login_token_expire_hours_raw)
            if login_token_expire_hours_raw is not None
            else env_settings.login_token_expire_hours
        )

        return SettingsResponse(
            punch_cooldown_seconds=cooldown,
            shift_checkin_early_minutes=early,
            shift_ical_url=ical,
            shift_sync_time=sync_time,
            site_name=site_name,
            site_subtitle=site_subtitle,
            punch_result_display_seconds=display_seconds,
            monthly_report_time=monthly_report_time,
            login_token_expire_hours=login_token_expire_hours,
        )

    async def get_all(self) -> SettingsResponse:
        """全設定値を取得する（DB + env フォールバック）。"""
        db_map = await self._load_db_map()
        return self._build_response(db_map)

    async def get_int(self, key: str) -> int:
        """指定キーの設定値を int で返す。"""
        result = await self.session.execute(select(SystemSetting).where(SystemSetting.key == key))
        row = result.scalar_one_or_none()
        if row is not None:
            return int(row.value)
        # env フォールバック
        return int(getattr(env_settings, key))

    async def get_str(self, key: str) -> str | None:
        """指定キーの設定値を str または None で返す。"""
        result = await self.session.execute(select(SystemSetting).where(SystemSetting.key == key))
        row = result.scalar_one_or_none()
        if row is not None:
            v = row.value
            return v if v != "" else None
        return getattr(env_settings, key, None)

    async def upsert(self, updates: SettingsPatchRequest, actor_id: str) -> SettingsResponse:
        """指定フィールドを upsert し、更新後の全設定値を返す。"""
        now = datetime.now(tz=UTC).replace(tzinfo=None)
        fields: dict[str, str] = {}
        if updates.punch_cooldown_seconds is not None:
            fields["punch_cooldown_seconds"] = str(updates.punch_cooldown_seconds)
        if updates.shift_checkin_early_minutes is not None:
            fields["shift_checkin_early_minutes"] = str(updates.shift_checkin_early_minutes)
        if updates.shift_ical_url is not None:
            # null / 空文字は空文字として格納（null 扱い）
            fields["shift_ical_url"] = updates.shift_ical_url or ""
        elif "shift_ical_url" in updates.model_fields_set:
            # 明示的に null が送られた場合
            fields["shift_ical_url"] = ""
        if updates.shift_sync_time is not None:
            fields["shift_sync_time"] = updates.shift_sync_time
        elif "shift_sync_time" in updates.model_fields_set:
            fields["shift_sync_time"] = ""
        if updates.site_name is not None:
            fields["site_name"] = updates.site_name
        if updates.site_subtitle is not None:
            fields["site_subtitle"] = updates.site_subtitle
        if updates.punch_result_display_seconds is not None:
            fields["punch_result_display_seconds"] = str(updates.punch_result_display_seconds)
        if updates.monthly_report_time is not None:
            fields["monthly_report_time"] = updates.monthly_report_time
        elif "monthly_report_time" in updates.model_fields_set:
            fields["monthly_report_time"] = ""
        if updates.login_token_expire_hours is not None:
            fields["login_token_expire_hours"] = str(updates.login_token_expire_hours)

        for key, value in fields.items():
            result = await self.session.execute(
                select(SystemSetting).where(SystemSetting.key == key)
            )
            row = result.scalar_one_or_none()
            if row is None:
                row = SystemSetting(
                    key=key,
                    value=value,
                    updated_by_user_id=actor_id,
                    updated_at=now,
                )
                self.session.add(row)
            else:
                row.value = value
                row.updated_by_user_id = actor_id
                row.updated_at = now

        await self.session.commit()
        result_settings = await self.get_all()
        if "shift_sync_time" in fields:
            from kint.scheduler import reschedule_calendar_sync

            reschedule_calendar_sync(result_settings.shift_sync_time)
        if "monthly_report_time" in fields:
            from kint.scheduler import reschedule_monthly_report

            reschedule_monthly_report(result_settings.monthly_report_time)
        return result_settings

    async def export(self, actor_email: str) -> SettingsExportFile:
        """メタデータ付きエクスポートオブジェクトを返す。"""
        current = await self.get_all()
        return SettingsExportFile(
            version=_KNOWN_VERSION,
            exported_at=datetime.now(tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            exported_by=actor_email,
            settings=current,
        )

    async def import_preview(self, payload: SettingsImportRequest) -> SettingsImportResult:
        """ドライラン: 差分を返す（DB 書き込みなし）。"""
        return await self._compute_import(payload, actor_id=None, apply=False)

    async def import_apply(
        self, payload: SettingsImportRequest, actor_id: str
    ) -> SettingsImportResult:
        """インポート適用: upsert 後に差分+結果を返す。"""
        return await self._compute_import(payload, actor_id=actor_id, apply=True)

    async def _compute_import(
        self,
        payload: SettingsImportRequest,
        actor_id: str | None,
        apply: bool,
    ) -> SettingsImportResult:
        """インポート差分計算（apply=True のとき DB 書き込みも行う）。"""
        warnings: list[str] = []
        if payload.version != _KNOWN_VERSION:
            warnings.append(
                f"未知のバージョン '{payload.version}' です。互換性を確認してください。"
            )

        current = await self.get_all()
        current_map: dict[str, int | str | None] = {
            "punch_cooldown_seconds": current.punch_cooldown_seconds,
            "shift_checkin_early_minutes": current.shift_checkin_early_minutes,
            "shift_ical_url": current.shift_ical_url,
            "shift_sync_time": current.shift_sync_time,
            "site_name": current.site_name,
            "site_subtitle": current.site_subtitle,
            "punch_result_display_seconds": current.punch_result_display_seconds,
            "monthly_report_time": current.monthly_report_time,
            "login_token_expire_hours": current.login_token_expire_hours,
        }

        changes: list[SettingsImportChange] = []
        ignored_keys: list[str] = []
        valid_updates: dict[str, str] = {}

        for key, raw_value in payload.settings.items():
            if key not in ALLOWED_SETTING_KEYS:
                ignored_keys.append(key)
                continue

            # 値の正規化
            if key in {"shift_ical_url", "shift_sync_time", "site_name", "site_subtitle", "monthly_report_time"}:
                new_value: int | str | None = raw_value if raw_value else None
            else:
                new_value = int(raw_value)

            before = current_map.get(key)
            if before == new_value:
                ignored_keys.append(key)
                continue

            changes.append(SettingsImportChange(key=key, before=before, after=new_value))
            valid_updates[key] = str(raw_value) if raw_value is not None else ""

        applied: SettingsResponse | None = None
        if apply and valid_updates:
            now = datetime.now(tz=UTC).replace(tzinfo=None)
            for key, value in valid_updates.items():
                result = await self.session.execute(
                    select(SystemSetting).where(SystemSetting.key == key)
                )
                row = result.scalar_one_or_none()
                if row is None:
                    row = SystemSetting(
                        key=key,
                        value=value,
                        updated_by_user_id=actor_id,
                        updated_at=now,
                    )
                    self.session.add(row)
                else:
                    row.value = value
                    row.updated_by_user_id = actor_id
                    row.updated_at = now
            await self.session.commit()
            applied = await self.get_all()
        elif apply:
            applied = current

        return SettingsImportResult(
            dry_run=not apply,
            changes=changes,
            ignored_keys=ignored_keys,
            warnings=warnings,
            applied=applied,
        )
