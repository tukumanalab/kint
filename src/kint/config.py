"""アプリケーション設定管理。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """環境変数から設定を読み込む。"""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite+aiosqlite:///./kint.db"
    secret_key: str = "change-me-in-production"
    debug: bool = False
    google_calendar_credentials_file: str | None = None
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


settings = Settings()
