"""システム設定スキーマ。"""

import re
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class SettingsResponse(BaseModel):
    """設定値レスポンス。"""

    punch_cooldown_seconds: int
    shift_checkin_early_minutes: int
    shift_ical_url: str | None
    shift_sync_time: str | None
    site_name: str


class SettingsPatchRequest(BaseModel):
    """設定値更新リクエスト（部分更新）。"""

    punch_cooldown_seconds: int | None = Field(default=None, ge=0, le=3600)
    shift_checkin_early_minutes: int | None = Field(default=None, ge=0, le=120)
    shift_ical_url: str | None = None
    shift_sync_time: str | None = None
    site_name: str | None = Field(default=None, min_length=1, max_length=50)

    @field_validator("shift_sync_time", mode="before")
    @classmethod
    def validate_shift_sync_time(cls, v: object) -> object:
        """HH:MM 形式（24 時間）または null のみ許可する。"""
        if v is None or v == "":
            return v
        if not isinstance(v, str) or not _TIME_RE.match(v):
            raise ValueError("shift_sync_time は HH:MM 形式（例: 03:00）で指定してください")
        return v

    @model_validator(mode="after")
    def at_least_one_field(self) -> "SettingsPatchRequest":
        """少なくとも 1 フィールドが設定されていることを検証する。"""
        if (
            self.punch_cooldown_seconds is None
            and self.shift_checkin_early_minutes is None
            and self.shift_ical_url is None
            and self.shift_sync_time is None
            and self.site_name is None
            and "shift_sync_time" not in self.model_fields_set
        ):
            raise ValueError("少なくとも 1 つのフィールドを指定してください")
        return self


class SettingsExportFile(BaseModel):
    """設定エクスポートファイル形式。"""

    version: str
    exported_at: str  # ISO 8601
    exported_by: str  # メールアドレス
    settings: SettingsResponse


class SettingsImportChange(BaseModel):
    """設定インポート時の変更差分。"""

    key: str
    before: int | str | None
    after: int | str | None


class SettingsImportRequest(BaseModel):
    """設定インポートリクエスト。"""

    version: str
    settings: dict[str, Any]

    # exported_at / exported_by は任意（エクスポートファイルの互換性）
    exported_at: str | None = None
    exported_by: str | None = None


class SettingsImportResult(BaseModel):
    """設定インポート結果。"""

    dry_run: bool
    changes: list[SettingsImportChange]
    ignored_keys: list[str]
    warnings: list[str]
    applied: SettingsResponse | None = None


class PublicSettingsResponse(BaseModel):
    """認証不要の公開用設定レスポンス。"""

    site_name: str
