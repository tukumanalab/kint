"""ログ参照ルーター。管理者のみアクセス可能。"""

import json
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from kint.dependencies import get_current_user
from kint.exceptions import KintForbiddenError
from kint.models.user import User
from kint.schemas.logs import LogEntry, LogsResponse

router = APIRouter(prefix="/logs", tags=["Logs"])

_LOG_FILE = Path("logs/kint.log")

_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


def _iter_log_entries(limit: int, level: str | None, keyword: str | None) -> list[LogEntry]:
    """ログファイルを末尾から読み、フィルタリングして返す。

    新しい行から返すため逆順で読む。フィルタ後に limit 件取得する。
    """
    if not _LOG_FILE.exists():
        return []

    entries: list[LogEntry] = []
    with _LOG_FILE.open(encoding="utf-8") as f:
        lines = f.readlines()

    for raw in reversed(lines):
        raw = raw.strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue

        entry = LogEntry(
            timestamp=data.get("timestamp", ""),
            level=data.get("level", ""),
            logger=data.get("logger", ""),
            message=data.get("message", ""),
            exc_info=data.get("exc_info"),
        )

        # レベルフィルタ
        if level and entry.level != level.upper():
            continue

        # キーワードフィルタ (大文字小文字を区別しない)
        if keyword:
            kw = keyword.lower()
            if kw not in entry.message.lower() and kw not in entry.logger.lower():
                continue

        entries.append(entry)
        if len(entries) >= limit:
            break

    return entries


@router.get("", response_model=LogsResponse)
async def get_logs(
    level: str | None = Query(default=None, description="ログレベルフィルタ (DEBUG/INFO/WARNING/ERROR/CRITICAL)"),
    keyword: str | None = Query(default=None, description="メッセージ・ロガー名のキーワード検索"),
    limit: int = Query(default=200, ge=1, le=2000, description="取得件数上限"),
    current_user: User = Depends(get_current_user),
) -> LogsResponse:
    """ログ一覧を取得する（管理者専用）。新しい順で返す。"""
    if current_user.role != "admin":
        raise KintForbiddenError(code="FORBIDDEN", message="管理者のみアクセスできます")

    if level is not None and level.upper() not in _LEVELS:
        from kint.exceptions import KintBadRequestError

        raise KintBadRequestError(
            code="INVALID_LEVEL",
            message=f"level は {', '.join(sorted(_LEVELS))} のいずれかを指定してください",
        )

    entries = _iter_log_entries(limit=limit, level=level, keyword=keyword)
    return LogsResponse(entries=entries, total=len(entries))
