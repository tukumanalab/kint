"""アプリケーションロギング設定。JSON Lines 形式でファイルに出力する。"""

import json
import logging
import logging.handlers
from datetime import UTC, datetime
from pathlib import Path


class _JsonFormatter(logging.Formatter):
    """ログレコードを JSON Lines 形式にフォーマットする。"""

    def format(self, record: logging.LogRecord) -> str:
        """1行 JSON に変換する。"""
        dt = datetime.fromtimestamp(record.created, tz=UTC)
        payload: dict = {
            "timestamp": dt.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(log_dir: str = "logs", log_level: str = "INFO") -> None:
    """ロギングを設定する。

    ファイルハンドラ (JSON Lines, RotatingFileHandler) とコンソールハンドラを両方設定する。
    既に設定済みの場合は何もしない。

    Args:
        log_dir: ログファイルを保存するディレクトリ。
        log_level: ログレベル文字列 (DEBUG / INFO / WARNING / ERROR / CRITICAL)。
    """
    root_logger = logging.getLogger()
    # 既にハンドラが設定されている場合はスキップ（uvicorn --reload 時の二重設定防止）
    if root_logger.handlers:
        return

    level = getattr(logging, log_level.upper(), logging.INFO)
    root_logger.setLevel(level)

    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)

    # --- ファイルハンドラ (JSON Lines, 5MB × 5世代) ---
    file_handler = logging.handlers.RotatingFileHandler(
        log_path / "kint.log",
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(_JsonFormatter())
    file_handler.setLevel(level)

    # --- コンソールハンドラ (人間が読みやすい形式) ---
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s")
    )
    console_handler.setLevel(level)

    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)
