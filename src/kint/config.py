"""アプリケーション設定管理。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """環境変数から設定を読み込む。"""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite+aiosqlite:///./kint.db"
    secret_key: str = "change-me-in-production"
    debug: bool = False
    google_calendar_credentials_file: str | None = None


settings = Settings()
