"""ログAPIスキーマ定義。"""

from pydantic import BaseModel


class LogEntry(BaseModel):
    """1件のログエントリ。"""

    timestamp: str
    level: str
    logger: str
    message: str
    exc_info: str | None = None


class LogsResponse(BaseModel):
    """ログ一覧レスポンス。"""

    entries: list[LogEntry]
    total: int
