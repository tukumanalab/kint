"""アプリケーション設定管理。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """環境変数から設定を読み込む。"""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite+aiosqlite:///./kint.db"
    secret_key: str = "change-me-in-production"
    debug: bool = False
    google_calendar_credentials_file: str | None = None
    shift_ical_url: str | None = None
    # Gmail API 認証 — リフレッシュトークン方式（推奨）
    gmail_user: str | None = None
    gmail_client_id: str | None = None
    gmail_client_secret: str | None = None
    gmail_refresh_token: str | None = None
    # Gmail API 認証 — credentials ファイル方式（フォールバック）
    gmail_oauth_credentials_file: str | None = None
    gmail_token_file: str = "gmail_token.json"
    gmail_sender_email: str = "noreply@kint.local"
    app_base_url: str = "http://localhost:8000"
    email_verification_expire_hours: int = 24
    google_client_id: str = ""  # GSI Client ID (Google Cloud Console で発行)
    admin_password: str = ""  # 管理者ロールで自動登録を許可するパスワード
    # 打刻判定ルール設定
    punch_cooldown_seconds: int = 60
    shift_checkin_early_minutes: int = 15
    site_name: str = "Kint"
    site_subtitle: str = "NFC 勤怠管理システム"
    punch_result_display_seconds: int = 30
    monthly_report_time: str = "20:00"
    login_token_expire_hours: int = 168
    enable_google_signup: bool = True
    overtime_allowance_minutes: int = 30


settings = Settings()
